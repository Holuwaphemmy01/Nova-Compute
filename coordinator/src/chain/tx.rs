//! Transaction model, serialization, parsing and txid.

use super::{ChainError, hash::{reversed, sha256d}};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutPoint {
    /// Txid in display order (as explorers and Electrum show it).
    pub txid: [u8; 32],
    pub vout: u32,
}

impl OutPoint {
    pub fn from_txid_hex(txid: &str, vout: u32) -> Result<Self, ChainError> {
        let b = hex::decode(txid).map_err(|_| ChainError::InvalidTx("txid is not hex"))?;
        Ok(Self { txid: b.try_into().map_err(|_| ChainError::InvalidTx("txid must be 32 bytes"))?, vout })
    }
    pub fn txid_hex(&self) -> String {
        hex::encode(self.txid)
    }
    /// The 32 bytes as serialized in a transaction / pushed by OP_OUTPOINTTXHASH.
    pub fn internal_hash(&self) -> [u8; 32] {
        reversed(self.txid)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TxIn {
    pub outpoint: OutPoint,
    pub unlocking_bytecode: Vec<u8>,
    pub sequence: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TxOut {
    pub value: u64,
    pub locking_bytecode: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transaction {
    pub version: u32,
    pub inputs: Vec<TxIn>,
    pub outputs: Vec<TxOut>,
    pub locktime: u32,
}

pub fn write_varint(out: &mut Vec<u8>, n: u64) {
    match n {
        0..=0xfc => out.push(n as u8),
        0xfd..=0xffff => {
            out.push(0xfd);
            out.extend_from_slice(&(n as u16).to_le_bytes());
        }
        0x1_0000..=0xffff_ffff => {
            out.push(0xfe);
            out.extend_from_slice(&(n as u32).to_le_bytes());
        }
        _ => {
            out.push(0xff);
            out.extend_from_slice(&n.to_le_bytes());
        }
    }
}

pub fn write_bytes(out: &mut Vec<u8>, b: &[u8]) {
    write_varint(out, b.len() as u64);
    out.extend_from_slice(b);
}

impl TxOut {
    pub fn serialize_into(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.value.to_le_bytes());
        write_bytes(out, &self.locking_bytecode);
    }
}

impl Transaction {
    pub fn serialize(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&self.version.to_le_bytes());
        write_varint(&mut out, self.inputs.len() as u64);
        for i in &self.inputs {
            out.extend_from_slice(&i.outpoint.internal_hash());
            out.extend_from_slice(&i.outpoint.vout.to_le_bytes());
            write_bytes(&mut out, &i.unlocking_bytecode);
            out.extend_from_slice(&i.sequence.to_le_bytes());
        }
        write_varint(&mut out, self.outputs.len() as u64);
        for o in &self.outputs {
            o.serialize_into(&mut out);
        }
        out.extend_from_slice(&self.locktime.to_le_bytes());
        out
    }

    pub fn to_hex(&self) -> String {
        hex::encode(self.serialize())
    }

    /// Txid in display order.
    pub fn txid(&self) -> [u8; 32] {
        reversed(sha256d(&self.serialize()))
    }

    pub fn txid_hex(&self) -> String {
        hex::encode(self.txid())
    }

    /// Parses a serialized transaction. CashTokens prefixes in outputs are rejected
    /// (the coordinator never handles token outputs).
    pub fn parse(bytes: &[u8]) -> Result<Self, ChainError> {
        let mut r = Reader { b: bytes, i: 0 };
        let version = r.u32()?;
        let n_in = r.varint()?;
        let mut inputs = Vec::new();
        for _ in 0..n_in {
            let mut h: [u8; 32] = r.take(32)?.try_into().unwrap();
            h.reverse();
            let vout = r.u32()?;
            let len = r.varint()? as usize;
            let unlocking_bytecode = r.take(len)?.to_vec();
            let sequence = r.u32()?;
            inputs.push(TxIn { outpoint: OutPoint { txid: h, vout }, unlocking_bytecode, sequence });
        }
        let n_out = r.varint()?;
        let mut outputs = Vec::new();
        for _ in 0..n_out {
            let value = u64::from_le_bytes(r.take(8)?.try_into().unwrap());
            let len = r.varint()? as usize;
            let locking_bytecode = r.take(len)?.to_vec();
            if locking_bytecode.first() == Some(&0xef) {
                return Err(ChainError::InvalidTx("token outputs are not supported"));
            }
            outputs.push(TxOut { value, locking_bytecode });
        }
        let locktime = r.u32()?;
        if r.i != bytes.len() {
            return Err(ChainError::InvalidTx("trailing bytes"));
        }
        Ok(Self { version, inputs, outputs, locktime })
    }

    pub fn parse_hex(s: &str) -> Result<Self, ChainError> {
        Self::parse(&hex::decode(s.trim()).map_err(|_| ChainError::InvalidTx("not hex"))?)
    }
}

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ChainError> {
        let end = self.i.checked_add(n).ok_or(ChainError::InvalidTx("overflow"))?;
        let s = self.b.get(self.i..end).ok_or(ChainError::InvalidTx("truncated"))?;
        self.i = end;
        Ok(s)
    }
    fn u32(&mut self) -> Result<u32, ChainError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn varint(&mut self) -> Result<u64, ChainError> {
        Ok(match self.take(1)?[0] {
            0xfd => u16::from_le_bytes(self.take(2)?.try_into().unwrap()) as u64,
            0xfe => u32::from_le_bytes(self.take(4)?.try_into().unwrap()) as u64,
            0xff => u64::from_le_bytes(self.take(8)?.try_into().unwrap()),
            n => n as u64,
        })
    }
}
