//! CashAddr encoding/decoding (P2PKH 20-byte and P2SH 20/32-byte payloads).

use super::ChainError;

const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddrType {
    P2pkh,
    P2sh,
}

fn polymod(values: &[u8]) -> u64 {
    let mut c: u64 = 1;
    for &d in values {
        let c0 = (c >> 35) as u8;
        c = ((c & 0x07_ffff_ffff) << 5) ^ d as u64;
        if c0 & 0x01 != 0 {
            c ^= 0x98_f2bc_8e61;
        }
        if c0 & 0x02 != 0 {
            c ^= 0x79_b76d_99e2;
        }
        if c0 & 0x04 != 0 {
            c ^= 0xf3_3e5f_b3c4;
        }
        if c0 & 0x08 != 0 {
            c ^= 0xae_2eab_e2a8;
        }
        if c0 & 0x10 != 0 {
            c ^= 0x1e_4f43_e470;
        }
    }
    c ^ 1
}

fn convert_bits(data: &[u8], from: u32, to: u32, pad: bool) -> Option<Vec<u8>> {
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    let maxv = (1 << to) - 1;
    let mut out = Vec::new();
    for &v in data {
        if (v as u32) >> from != 0 {
            return None;
        }
        acc = (acc << from) | v as u32;
        bits += from;
        while bits >= to {
            bits -= to;
            out.push(((acc >> bits) & maxv) as u8);
        }
    }
    if pad {
        if bits > 0 {
            out.push(((acc << (to - bits)) & maxv) as u8);
        }
    } else if bits >= from || ((acc << (to - bits)) & maxv) != 0 {
        return None;
    }
    Some(out)
}

fn size_bits(len: usize) -> Option<u8> {
    Some(match len {
        20 => 0,
        24 => 1,
        28 => 2,
        32 => 3,
        40 => 4,
        48 => 5,
        56 => 6,
        64 => 7,
        _ => return None,
    })
}

fn prefix_5bit(prefix: &str) -> Vec<u8> {
    prefix.bytes().map(|b| b & 0x1f).chain(std::iter::once(0)).collect()
}

pub fn encode(prefix: &str, kind: AddrType, payload: &[u8]) -> Result<String, ChainError> {
    let size = size_bits(payload.len()).ok_or_else(|| ChainError::InvalidAddress("unsupported payload length".into()))?;
    let version = (match kind {
        AddrType::P2pkh => 0u8,
        AddrType::P2sh => 1u8,
    } << 3)
        | size;
    let mut raw = vec![version];
    raw.extend_from_slice(payload);
    let data = convert_bits(&raw, 8, 5, true).unwrap();
    let mut check_input = prefix_5bit(prefix);
    check_input.extend_from_slice(&data);
    check_input.extend_from_slice(&[0u8; 8]);
    let pm = polymod(&check_input);
    let mut s = String::with_capacity(prefix.len() + 1 + data.len() + 8);
    s.push_str(prefix);
    s.push(':');
    for d in data {
        s.push(CHARSET[d as usize] as char);
    }
    for i in 0..8 {
        s.push(CHARSET[((pm >> (5 * (7 - i))) & 0x1f) as usize] as char);
    }
    Ok(s)
}

/// Decodes a cashaddr; `expected_prefix` is used when the address has no prefix.
pub fn decode(addr: &str, expected_prefix: &str) -> Result<(AddrType, Vec<u8>), ChainError> {
    let lower = addr.to_ascii_lowercase();
    if lower != addr && addr.to_ascii_uppercase() != addr {
        return Err(ChainError::InvalidAddress("mixed case".into()));
    }
    let (prefix, body) = match lower.split_once(':') {
        Some((p, b)) => (p.to_string(), b.to_string()),
        None => (expected_prefix.to_string(), lower.clone()),
    };
    if prefix != expected_prefix {
        return Err(ChainError::InvalidAddress(format!("wrong network prefix {prefix:?}, expected {expected_prefix:?}")));
    }
    let mut data = Vec::with_capacity(body.len());
    for c in body.bytes() {
        let v = CHARSET.iter().position(|&x| x == c).ok_or_else(|| ChainError::InvalidAddress("invalid character".into()))?;
        data.push(v as u8);
    }
    if data.len() < 8 {
        return Err(ChainError::InvalidAddress("too short".into()));
    }
    let mut check_input = prefix_5bit(&prefix);
    check_input.extend_from_slice(&data);
    if polymod(&check_input) != 0 {
        return Err(ChainError::InvalidAddress("bad checksum".into()));
    }
    let raw = convert_bits(&data[..data.len() - 8], 5, 8, false).ok_or_else(|| ChainError::InvalidAddress("bad padding".into()))?;
    let (&version, payload) = raw.split_first().ok_or_else(|| ChainError::InvalidAddress("empty".into()))?;
    let kind = match (version >> 3) & 0x0f {
        0 => AddrType::P2pkh,
        1 => AddrType::P2sh,
        t => return Err(ChainError::InvalidAddress(format!("unsupported address type {t} (token-aware addresses not accepted)"))),
    };
    if size_bits(payload.len()) != Some(version & 0x07) {
        return Err(ChainError::InvalidAddress("payload length mismatch".into()));
    }
    Ok((kind, payload.to_vec()))
}

/// Decodes a P2PKH cashaddr into its 20-byte pubkey hash.
pub fn decode_p2pkh(addr: &str, expected_prefix: &str) -> Result<[u8; 20], ChainError> {
    match decode(addr, expected_prefix)? {
        (AddrType::P2pkh, p) if p.len() == 20 => Ok(p.try_into().unwrap()),
        _ => Err(ChainError::InvalidAddress("not a P2PKH address".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_known_vector() {
        // libauth: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: 20 zero bytes })
        let a = encode("bchtest", AddrType::P2pkh, &[0u8; 20]).unwrap();
        assert_eq!(a, "bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdpn3jdgd");
        assert_eq!(decode_p2pkh(&a, "bchtest").unwrap(), [0u8; 20]);
        assert!(decode_p2pkh(&a, "bitcoincash").is_err());
        assert!(decode_p2pkh("bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdpn3jdgq", "bchtest").is_err());
    }
}
