//! Throughput benchmark: `cargo run --release --example bench`
use std::time::Instant;

use nova_kernel::{Params, run_chunk};

fn main() {
    let params = Params { thickness_cm: 10.0, mfp_cm: 3.0, absorb_prob: 0.18 };
    let trials = 1_000_000;

    let start = Instant::now();
    let r = run_chunk(params, [0; 32], b"0xNOVA2026", 0, trials);
    let secs = start.elapsed().as_secs_f64();

    println!("trials:        {trials}");
    println!("time:          {:.3} s", secs);
    println!("particles/s:   {:.0}", trials as f64 / secs);
    println!(
        "transmitted:   {} ({:.2}%)",
        r.transmitted,
        100.0 * r.transmitted as f64 / trials as f64
    );
    println!("reflected:     {}", r.reflected);
    println!("absorbed:      {}", r.absorbed);
    println!("hash:          {}", r.hash);
}
