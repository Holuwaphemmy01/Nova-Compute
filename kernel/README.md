# kernel/ (`nova-kernel`)

Deterministic Monte Carlo neutron-transport kernel in Rust. It computes one **chunk** of
a job (particles fired into a 2D slab) and returns tallies plus a SHA-256 hash. The same
code runs natively (coordinator) and in browsers via WebAssembly, with **bit-identical**
results, so two honest workers computing the same chunk always produce the same hash.

## API

```rust
use nova_kernel::{Params, run_chunk};

let r = run_chunk(
    Params { thickness_cm: 10.0, mfp_cm: 3.0, absorb_prob: 0.18 },
    job_id,          // [u8; 32]
    b"master seed",  // &[u8]
    7,               // chunk index
    10_000,          // trials (particles)
);
// r.transmitted, r.reflected, r.absorbed, r.histogram (64 bins), r.hash (hex)
```

Browser (`wasm-bindgen`): `new Simulator(params, jobIdHex, masterSeedHex, index, trials)`,
then `step(n)` → `{ done, transmitted, reflected, absorbed, sample_tracks }` and
`finish()` → `{ transmitted, reflected, absorbed, histogram, hash }`. Stepping in any batch
sizes gives the same hash as `run_chunk`.

## Specification

| | |
|---|---|
| Chunk seed | `sha256(master_seed ‖ index as u32 BE)` → `ChaCha8Rng::from_seed` |
| Uniform | `(next_u64() >> 11) as f64 × 2⁻⁵³`, in `[0, 1)` |
| Start | `x = 0`, `θ = (u − 0.5) · π · 0.9` |
| Step | `d = −ln(1 − u) · mfp`, `x += cos θ · d` |
| Exit | `x ≥ L` → transmitted, `x ≤ 0` → reflected |
| Collision | add `x` to a 64-bin histogram over `[0, L)`; absorbed with probability `absorb_prob`, else `θ = u · 2π` |
| Cap | 1000 steps, then counted as absorbed |
| Output bytes | u32 LE transmitted, reflected, absorbed, then 64 × u32 LE bins |
| Hash | `sha256(job_id ‖ index u32 BE ‖ output bytes)`, lower-case hex |

### Determinism rules

- `f64` transcendental functions only via the pure-Rust `libm` crate (never `f64::ln/cos/sin`).
- Uniforms built from raw `next_u64()` bits, never `rand` distributions.
- One sequential RNG stream per chunk; no threads, time, hash-map iteration or
  reordered floating-point reductions.
- Recording sample paths for drawing never changes how the RNG is consumed.
- `Cargo.lock` pins `rand_chacha`; changing its version requires re-checking the golden hash.

## Commands

```bash
cargo test -p nova-kernel                      # native tests (incl. golden hash)
wasm-pack test --node kernel                   # same tests compiled to wasm32
cargo run --release -p nova-kernel --example bench
cd web && pnpm kernel:build                    # build the WASM package into web/src/kernel/pkg
```
