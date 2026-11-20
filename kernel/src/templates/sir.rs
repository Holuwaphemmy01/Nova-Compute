//! Stochastic SIR epidemic ensemble: one chunk = `trials` (= runs_per_chunk) independent outbreaks.
//!
//! β = r0 / recovery_days, γ = 1 / recovery_days. Gillespie: rates βSI/N (infection) and γI
//! (recovery); waiting time −libm::log(1 − u)/total; a second u picks the event
//! (infection if u·total < βSI/N). Each run starts at S = N − I0, I = I0, R = 0 and ends when
//! I = 0. Per run: final size R_end/N, peak I/N, and the time of the peak (days).
//!
//! Output bytes (LE): 64 × u32 histogram of final size over [0,1], 64 × u32 histogram of peak
//! fraction over [0,1], u32 count of major outbreaks (final size > 10%), f64 bits of the sum of
//! peak days, then 180 × u32 daily infected counts of the chunk's first run (I at each integer
//! day; 0 after extinction), for drawing.

use rand_chacha::ChaCha8Rng;
use rand_core::SeedableRng;
use serde_json::{Value, json};

use super::{TemplateOutput, f64_at, int, num, read_u32s};
use crate::{KernelError, chunk_hash, chunk_seed, uniform};

pub const BINS: usize = 64;
pub const CURVE_DAYS: usize = 180;
pub const MAJOR_THRESHOLD: f64 = 0.10;
pub const OUTPUT_LEN: usize = 4 * BINS * 2 + 4 + 8 + 4 * CURVE_DAYS;

#[derive(Clone, Debug, PartialEq)]
pub struct SirParams {
    pub population: u32,
    pub initial_infected: u32,
    pub r0: f64,
    pub recovery_days: f64,
    pub runs_per_chunk: u32,
}

impl SirParams {
    pub fn from_value(v: &Value) -> Result<Self, KernelError> {
        if !v.is_object() {
            return Err(KernelError::InvalidParams("params must be a JSON object"));
        }
        let p = SirParams {
            population: int(v, "population", 10_000, 100, 100_000, "population must be an integer in 100..=100,000")?,
            initial_infected: int(v, "initial_infected", 10, 1, 100_000, "initial_infected must be an integer >= 1")?,
            r0: num(v, "r0", 2.5)?,
            recovery_days: num(v, "recovery_days", 7.0)?,
            runs_per_chunk: int(v, "runs_per_chunk", 200, 1, 10_000, "runs_per_chunk must be an integer in 1..=10,000")?,
        };
        if p.initial_infected >= p.population {
            return Err(KernelError::InvalidParams("initial_infected must be smaller than the population"));
        }
        if !(0.5..=6.0).contains(&p.r0) {
            return Err(KernelError::InvalidParams("r0 must be in 0.5..=6"));
        }
        if !(1.0..=60.0).contains(&p.recovery_days) {
            return Err(KernelError::InvalidParams("recovery_days must be in 1..=60"));
        }
        Ok(p)
    }

    pub fn to_value(&self) -> Value {
        json!({ "population": self.population, "initial_infected": self.initial_infected, "r0": self.r0, "recovery_days": self.recovery_days, "runs_per_chunk": self.runs_per_chunk })
    }
}

struct Run {
    final_size: f64,
    peak_fraction: f64,
    peak_day: f64,
    curve: Option<Vec<u32>>,
}

pub struct SirChunk {
    p: SirParams,
    beta: f64,
    gamma: f64,
    rng: ChaCha8Rng,
    job_id: [u8; 32],
    index: u32,
    total: u32,
    runs: u32,
    final_hist: [u32; BINS],
    peak_hist: [u32; BINS],
    majors: u32,
    sum_peak_days: f64,
    curve: [u32; CURVE_DAYS],
}

fn bin(x: f64) -> usize {
    ((x * BINS as f64) as usize).min(BINS - 1)
}

impl SirChunk {
    pub fn new(p: SirParams, job_id: [u8; 32], master_seed: &[u8], index: u32, trials: u32) -> Result<Self, KernelError> {
        if trials == 0 {
            return Err(KernelError::InvalidParams("trials (outbreaks per chunk) must be >= 1"));
        }
        Ok(SirChunk {
            beta: p.r0 / p.recovery_days,
            gamma: 1.0 / p.recovery_days,
            p,
            rng: ChaCha8Rng::from_seed(chunk_seed(master_seed, index)),
            job_id,
            index,
            total: trials,
            runs: 0,
            final_hist: [0; BINS],
            peak_hist: [0; BINS],
            majors: 0,
            sum_peak_days: 0.0,
            curve: [0; CURVE_DAYS],
        })
    }

    pub fn done(&self) -> u32 {
        self.runs
    }

    pub fn total(&self) -> u32 {
        self.total
    }

    /// One outbreak. Recording the daily curve never touches the RNG.
    fn run_one(&mut self, record: bool) -> Run {
        let n = self.p.population as f64;
        let (mut s, mut i, mut r) = ((self.p.population - self.p.initial_infected) as u64, self.p.initial_infected as u64, 0u64);
        let mut t = 0.0_f64;
        let (mut peak, mut peak_t) = (i, 0.0_f64);
        let mut curve = if record { Some(Vec::with_capacity(CURVE_DAYS)) } else { None };
        while i > 0 {
            let rate_inf = self.beta * s as f64 * i as f64 / n;
            let total = rate_inf + self.gamma * i as f64;
            let t_next = t + -libm::log(1.0 - uniform(&mut self.rng)) / total;
            if let Some(c) = curve.as_mut() {
                while c.len() < CURVE_DAYS && (c.len() as f64) < t_next {
                    c.push(i as u32);
                }
            }
            t = t_next;
            if uniform(&mut self.rng) * total < rate_inf {
                s -= 1;
                i += 1;
                if i > peak {
                    peak = i;
                    peak_t = t;
                }
            } else {
                i -= 1;
                r += 1;
            }
        }
        if let Some(c) = curve.as_mut() {
            c.resize(CURVE_DAYS, 0);
        }
        Run { final_size: r as f64 / n, peak_fraction: peak as f64 / n, peak_day: peak_t, curve }
    }

    /// Runs up to `n` outbreaks. Progress: { done, total, majors, final_size_hist, sample_curves }
    /// with the daily curves of up to `samples` outbreaks from this step.
    pub fn step(&mut self, n: u32, samples: usize) -> Value {
        let end = self.total.min(self.runs.saturating_add(n));
        let mut sample_curves = Vec::new();
        let mut k = 0usize;
        while self.runs < end {
            let first = self.runs == 0;
            let run = self.run_one(first || k < samples);
            self.final_hist[bin(run.final_size)] += 1;
            self.peak_hist[bin(run.peak_fraction)] += 1;
            if run.final_size > MAJOR_THRESHOLD {
                self.majors += 1;
            }
            self.sum_peak_days += run.peak_day;
            if let Some(c) = run.curve {
                if first {
                    self.curve.copy_from_slice(&c);
                }
                if k < samples {
                    sample_curves.push(c);
                }
            }
            self.runs += 1;
            k += 1;
        }
        json!({
            "done": self.runs,
            "total": self.total,
            "majors": self.majors,
            "final_size_hist": self.final_hist.to_vec(),
            "sample_curves": sample_curves,
        })
    }

    pub fn output_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(OUTPUT_LEN);
        for v in self.final_hist.iter().chain(self.peak_hist.iter()).chain(std::iter::once(&self.majors)) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(&self.sum_peak_days.to_bits().to_le_bytes());
        for v in self.curve {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out
    }

    pub fn finish(&mut self) -> TemplateOutput {
        while self.runs < self.total {
            self.step(u32::MAX, 0);
        }
        let output = self.output_bytes();
        TemplateOutput { hash: chunk_hash(&self.job_id, self.index, &output), output }
    }
}

pub fn decode(b: &[u8]) -> Result<Value, KernelError> {
    if b.len() != OUTPUT_LEN {
        return Err(KernelError::InvalidParams("SIR output has the wrong length"));
    }
    let head = read_u32s(&b[..4 * (2 * BINS + 1)], 2 * BINS + 1)?;
    let off = 4 * (2 * BINS + 1);
    let curve = read_u32s(&b[off + 8..], CURVE_DAYS)?;
    let runs: u32 = head[..BINS].iter().sum();
    Ok(json!({
        "runs": runs,
        "final_size_hist": head[..BINS].to_vec(),
        "peak_hist": head[BINS..2 * BINS].to_vec(),
        "major_outbreaks": head[2 * BINS],
        "sum_peak_days": f64_at(b, off),
        "curve": curve,
    }))
}
