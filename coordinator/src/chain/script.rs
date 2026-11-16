//! Script building: minimal pushes, script numbers, CashScript ASM assembly, standard templates.

use super::ChainError;

pub mod op {
    pub const OP_0: u8 = 0x00;
    pub const OP_PUSHDATA1: u8 = 0x4c;
    pub const OP_PUSHDATA2: u8 = 0x4d;
    pub const OP_PUSHDATA4: u8 = 0x4e;
    pub const OP_1NEGATE: u8 = 0x4f;
    pub const OP_1: u8 = 0x51;
    pub const OP_RETURN: u8 = 0x6a;
    pub const OP_DUP: u8 = 0x76;
    pub const OP_EQUAL: u8 = 0x87;
    pub const OP_EQUALVERIFY: u8 = 0x88;
    pub const OP_HASH160: u8 = 0xa9;
    pub const OP_HASH256: u8 = 0xaa;
    pub const OP_CHECKSIG: u8 = 0xac;
}

/// BCH opcode names → bytes (everything CashScript can emit, plus the rest of the common set).
fn opcode(name: &str) -> Option<u8> {
    let n = name.strip_prefix("OP_")?;
    if let Ok(k) = n.parse::<u8>() {
        return match k {
            0 => Some(0x00),
            1..=16 => Some(0x50 + k),
            _ => None,
        };
    }
    Some(match n {
        "FALSE" => 0x00,
        "TRUE" => 0x51,
        "PUSHDATA1" => 0x4c,
        "PUSHDATA2" => 0x4d,
        "PUSHDATA4" => 0x4e,
        "1NEGATE" => 0x4f,
        "NOP" => 0x61,
        "IF" => 0x63,
        "NOTIF" => 0x64,
        "ELSE" => 0x67,
        "ENDIF" => 0x68,
        "VERIFY" => 0x69,
        "RETURN" => 0x6a,
        "TOALTSTACK" => 0x6b,
        "FROMALTSTACK" => 0x6c,
        "2DROP" => 0x6d,
        "2DUP" => 0x6e,
        "3DUP" => 0x6f,
        "2OVER" => 0x70,
        "2ROT" => 0x71,
        "2SWAP" => 0x72,
        "IFDUP" => 0x73,
        "DEPTH" => 0x74,
        "DROP" => 0x75,
        "DUP" => 0x76,
        "NIP" => 0x77,
        "OVER" => 0x78,
        "PICK" => 0x79,
        "ROLL" => 0x7a,
        "ROT" => 0x7b,
        "SWAP" => 0x7c,
        "TUCK" => 0x7d,
        "CAT" => 0x7e,
        "SPLIT" => 0x7f,
        "NUM2BIN" => 0x80,
        "BIN2NUM" => 0x81,
        "SIZE" => 0x82,
        "INVERT" => 0x83,
        "AND" => 0x84,
        "OR" => 0x85,
        "XOR" => 0x86,
        "EQUAL" => 0x87,
        "EQUALVERIFY" => 0x88,
        "1ADD" => 0x8b,
        "1SUB" => 0x8c,
        "NEGATE" => 0x8f,
        "ABS" => 0x90,
        "NOT" => 0x91,
        "0NOTEQUAL" => 0x92,
        "ADD" => 0x93,
        "SUB" => 0x94,
        "MUL" => 0x95,
        "DIV" => 0x96,
        "MOD" => 0x97,
        "LSHIFTNUM" => 0x98,
        "RSHIFTNUM" => 0x99,
        "BOOLAND" => 0x9a,
        "BOOLOR" => 0x9b,
        "NUMEQUAL" => 0x9c,
        "NUMEQUALVERIFY" => 0x9d,
        "NUMNOTEQUAL" => 0x9e,
        "LESSTHAN" => 0x9f,
        "GREATERTHAN" => 0xa0,
        "LESSTHANOREQUAL" => 0xa1,
        "GREATERTHANOREQUAL" => 0xa2,
        "MIN" => 0xa3,
        "MAX" => 0xa4,
        "WITHIN" => 0xa5,
        "RIPEMD160" => 0xa6,
        "SHA1" => 0xa7,
        "SHA256" => 0xa8,
        "HASH160" => 0xa9,
        "HASH256" => 0xaa,
        "CODESEPARATOR" => 0xab,
        "CHECKSIG" => 0xac,
        "CHECKSIGVERIFY" => 0xad,
        "CHECKMULTISIG" => 0xae,
        "CHECKMULTISIGVERIFY" => 0xaf,
        "CHECKLOCKTIMEVERIFY" => 0xb1,
        "CHECKSEQUENCEVERIFY" => 0xb2,
        "CHECKDATASIG" => 0xba,
        "CHECKDATASIGVERIFY" => 0xbb,
        "REVERSEBYTES" => 0xbc,
        "INPUTINDEX" => 0xc0,
        "ACTIVEBYTECODE" => 0xc1,
        "TXVERSION" => 0xc2,
        "TXINPUTCOUNT" => 0xc3,
        "TXOUTPUTCOUNT" => 0xc4,
        "TXLOCKTIME" => 0xc5,
        "UTXOVALUE" => 0xc6,
        "UTXOBYTECODE" => 0xc7,
        "OUTPOINTTXHASH" => 0xc8,
        "OUTPOINTINDEX" => 0xc9,
        "INPUTBYTECODE" => 0xca,
        "INPUTSEQUENCENUMBER" => 0xcb,
        "OUTPUTVALUE" => 0xcc,
        "OUTPUTBYTECODE" => 0xcd,
        "UTXOTOKENCATEGORY" => 0xce,
        "UTXOTOKENCOMMITMENT" => 0xcf,
        "UTXOTOKENAMOUNT" => 0xd0,
        "OUTPUTTOKENCATEGORY" => 0xd1,
        "OUTPUTTOKENCOMMITMENT" => 0xd2,
        "OUTPUTTOKENAMOUNT" => 0xd3,
        _ => return None,
    })
}

/// Minimal data push (as libauth's `encodeDataPush`): OP_0 for empty, OP_1..OP_16 / OP_1NEGATE
/// for single-byte 1..16 / 0x81, otherwise direct push or PUSHDATA1/2/4.
pub fn push_data(out: &mut Vec<u8>, data: &[u8]) {
    match data.len() {
        0 => out.push(op::OP_0),
        1 if (1..=16).contains(&data[0]) => out.push(0x50 + data[0]),
        1 if data[0] == 0x81 => out.push(op::OP_1NEGATE),
        n @ 1..=75 => {
            out.push(n as u8);
            out.extend_from_slice(data);
        }
        n @ 76..=0xff => {
            out.push(op::OP_PUSHDATA1);
            out.push(n as u8);
            out.extend_from_slice(data);
        }
        n @ 0x100..=0xffff => {
            out.push(op::OP_PUSHDATA2);
            out.extend_from_slice(&(n as u16).to_le_bytes());
            out.extend_from_slice(data);
        }
        n => {
            out.push(op::OP_PUSHDATA4);
            out.extend_from_slice(&(n as u32).to_le_bytes());
            out.extend_from_slice(data);
        }
    }
}

/// Minimally-encoded script number (little-endian sign-magnitude), e.g. 1200 → b0 04.
pub fn script_num(n: i64) -> Vec<u8> {
    if n == 0 {
        return Vec::new();
    }
    let neg = n < 0;
    let mut abs = n.unsigned_abs();
    let mut out = Vec::new();
    while abs > 0 {
        out.push((abs & 0xff) as u8);
        abs >>= 8;
    }
    if out.last().unwrap() & 0x80 != 0 {
        out.push(if neg { 0x80 } else { 0x00 });
    } else if neg {
        *out.last_mut().unwrap() |= 0x80;
    }
    out
}

/// Assembles CashScript artifact ASM (space-separated opcodes and hex data pushes).
pub fn asm_to_bytecode(asm: &str) -> Result<Vec<u8>, ChainError> {
    let mut out = Vec::new();
    for tok in asm.split_whitespace() {
        if tok.starts_with("OP_") {
            let b = opcode(tok).ok_or_else(|| ChainError::InvalidScript(format!("unknown opcode {tok}")))?;
            out.push(b);
        } else {
            let data = hex::decode(tok).map_err(|_| ChainError::InvalidScript(format!("bad hex token {tok}")))?;
            push_data(&mut out, &data);
        }
    }
    Ok(out)
}

/// OP_DUP OP_HASH160 <pkh> OP_EQUALVERIFY OP_CHECKSIG
pub fn p2pkh(pkh: &[u8; 20]) -> Vec<u8> {
    let mut s = vec![op::OP_DUP, op::OP_HASH160, 20];
    s.extend_from_slice(pkh);
    s.extend_from_slice(&[op::OP_EQUALVERIFY, op::OP_CHECKSIG]);
    s
}

/// OP_HASH256 <hash256(redeem)> OP_EQUAL
pub fn p2sh32(script_hash: &[u8; 32]) -> Vec<u8> {
    let mut s = vec![op::OP_HASH256, 32];
    s.extend_from_slice(script_hash);
    s.push(op::OP_EQUAL);
    s
}

/// OP_RETURN followed by one push per chunk.
pub fn op_return(chunks: &[&[u8]]) -> Vec<u8> {
    let mut s = vec![op::OP_RETURN];
    for c in chunks {
        push_data(&mut s, c);
    }
    s
}

/// If `script` is P2PKH, returns its pubkey hash.
pub fn p2pkh_hash(script: &[u8]) -> Option<[u8; 20]> {
    if script.len() == 25 && script[..3] == [op::OP_DUP, op::OP_HASH160, 20] && script[23..] == [op::OP_EQUALVERIFY, op::OP_CHECKSIG] {
        script[3..23].try_into().ok()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_numbers() {
        assert_eq!(script_num(0), Vec::<u8>::new());
        assert_eq!(script_num(1200), vec![0xb0, 0x04]);
        assert_eq!(script_num(127), vec![0x7f]);
        assert_eq!(script_num(128), vec![0x80, 0x00]);
        assert_eq!(script_num(-1), vec![0x81]);
        assert_eq!(script_num(1_800_000_000), vec![0x00, 0xd2, 0x49, 0x6b]);
    }

    #[test]
    fn minimal_pushes() {
        let mut v = Vec::new();
        push_data(&mut v, &[0x14]);
        push_data(&mut v, &[0x05]);
        push_data(&mut v, &[]);
        assert_eq!(v, vec![0x01, 0x14, 0x55, 0x00]);
        let mut big = Vec::new();
        push_data(&mut big, &[7u8; 245]);
        assert_eq!(&big[..2], &[0x4c, 0xf5]);
    }
}
