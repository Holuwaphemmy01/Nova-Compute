//! Merkle root of verified chunk hashes and the job's OP_RETURN payload.

use super::{hash::sha256, script::op_return};

/// SHA-256 pairwise Merkle root over `leaves` (chunk-index order); the last leaf is
/// duplicated when a level has an odd count. A single leaf is its own root.
pub fn merkle_root(leaves: &[[u8; 32]]) -> Option<[u8; 32]> {
    if leaves.is_empty() {
        return None;
    }
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        if level.len() % 2 == 1 {
            level.push(*level.last().unwrap());
        }
        level = level
            .chunks_exact(2)
            .map(|p| {
                let mut b = [0u8; 64];
                b[..32].copy_from_slice(&p[0]);
                b[32..].copy_from_slice(&p[1]);
                sha256(&b)
            })
            .collect();
    }
    Some(level[0])
}

/// "NOVA" ‖ jobId ‖ root (68 bytes), pushed as one OP_RETURN data element.
pub fn op_return_payload(job_id: &[u8; 32], root: &[u8; 32]) -> Vec<u8> {
    let mut p = b"NOVA".to_vec();
    p.extend_from_slice(job_id);
    p.extend_from_slice(root);
    p
}

pub fn op_return_script(job_id: &[u8; 32], root: &[u8; 32]) -> Vec<u8> {
    op_return(&[&op_return_payload(job_id, root)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roots() {
        let a = sha256(b"a");
        let b = sha256(b"b");
        let c = sha256(b"c");
        let pair = |x: [u8; 32], y: [u8; 32]| {
            let mut v = x.to_vec();
            v.extend_from_slice(&y);
            sha256(&v)
        };
        assert_eq!(merkle_root(&[]), None);
        assert_eq!(merkle_root(&[a]), Some(a));
        assert_eq!(merkle_root(&[a, b]), Some(pair(a, b)));
        assert_eq!(merkle_root(&[a, b, c]), Some(pair(pair(a, b), pair(c, c))));
        let script = op_return_script(&[1; 32], &a);
        assert_eq!(&script[..2], &[0x6a, 68]);
        assert_eq!(&script[2..6], b"NOVA");
    }
}
