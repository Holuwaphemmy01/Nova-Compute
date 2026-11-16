//! The NovaEscrow contract: loads the cashc artifact and builds the redeem script, P2SH32
//! locking bytecode and address exactly as the CashScript SDK does.

use serde::Deserialize;

use super::{
    ChainError, Network,
    cashaddr::{self, AddrType},
    hash::sha256d,
    script::{asm_to_bytecode, p2sh32, push_data, script_num},
};

/// The compiled artifact, embedded at build time (source of truth: contracts/).
pub const ARTIFACT_JSON: &str = include_str!("../../../contracts/artifacts/NovaEscrow.json");

/// Value of one chunk UTXO = 2 × price + this margin (pays the payout tx fee). Matches contracts/src/escrow.ts.
pub const FEE_MARGIN: u64 = 600;

pub fn chunk_value(price_per_worker: u64) -> u64 {
    2 * price_per_worker + FEE_MARGIN
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub contract_name: String,
    pub constructor_inputs: Vec<AbiInput>,
    pub abi: Vec<AbiFunction>,
    pub bytecode: String,
    pub compiler: Compiler,
}

#[derive(Debug, Deserialize)]
pub struct AbiInput {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Deserialize)]
pub struct AbiFunction {
    pub name: String,
    pub inputs: Vec<AbiInput>,
}

#[derive(Debug, Deserialize)]
pub struct Compiler {
    pub name: String,
    pub version: String,
}

impl Artifact {
    pub fn load(json: &str) -> Result<Self, ChainError> {
        let a: Artifact = serde_json::from_str(json).map_err(|e| ChainError::InvalidArtifact(e.to_string()))?;
        let expected = ["bytes20", "pubkey", "bytes32", "int", "int"];
        let got: Vec<&str> = a.constructor_inputs.iter().map(|i| i.kind.as_str()).collect();
        if a.contract_name != "NovaEscrow" || got != expected {
            return Err(ChainError::InvalidArtifact(format!("unexpected contract {} with constructor {got:?}", a.contract_name)));
        }
        Ok(a)
    }

    pub fn embedded() -> Self {
        Self::load(ARTIFACT_JSON).expect("embedded artifact is valid")
    }

    /// Index of an ABI function = its selector in the unlocking bytecode.
    pub fn function_index(&self, name: &str) -> Option<usize> {
        self.abi.iter().position(|f| f.name == name)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowParams {
    pub researcher_pkh: [u8; 20],
    pub oracle_pk: [u8; 33],
    pub job_id: [u8; 32],
    pub price_per_worker: u64,
    pub refund_after: u32,
}

impl EscrowParams {
    /// Encoded constructor arguments in declaration order (as `contract.encodedConstructorArgs`).
    pub fn encoded_args(&self) -> Vec<Vec<u8>> {
        vec![
            self.researcher_pkh.to_vec(),
            self.oracle_pk.to_vec(),
            self.job_id.to_vec(),
            script_num(self.price_per_worker as i64),
            script_num(self.refund_after as i64),
        ]
    }
}

#[derive(Clone, Debug)]
pub struct Escrow {
    pub params: EscrowParams,
    pub redeem_script: Vec<u8>,
    pub locking_bytecode: Vec<u8>,
    pub payout_selector: i64,
    pub close_selector: i64,
}

impl Escrow {
    pub fn new(artifact: &Artifact, params: EscrowParams) -> Result<Self, ChainError> {
        // CashScript: constructor args pushed in REVERSE order, then the compiled template.
        let mut redeem_script = Vec::new();
        for arg in params.encoded_args().iter().rev() {
            push_data(&mut redeem_script, arg);
        }
        redeem_script.extend(asm_to_bytecode(&artifact.bytecode)?);
        let locking_bytecode = p2sh32(&sha256d(&redeem_script));
        let selector = |name| artifact.function_index(name).map(|i| i as i64).ok_or_else(|| ChainError::InvalidArtifact(format!("missing function {name}")));
        Ok(Self { payout_selector: selector("payout")?, close_selector: selector("close")?, params, redeem_script, locking_bytecode })
    }

    pub fn script_hash(&self) -> [u8; 32] {
        sha256d(&self.redeem_script)
    }

    pub fn address(&self, network: Network) -> String {
        cashaddr::encode(network.cashaddr_prefix(), AddrType::P2sh, &self.script_hash()).unwrap()
    }

    /// Electrum scripthash of the locking bytecode (sha256, reversed, hex).
    pub fn electrum_scripthash(&self) -> String {
        electrum_scripthash(&self.locking_bytecode)
    }
}

pub fn electrum_scripthash(locking_bytecode: &[u8]) -> String {
    let mut h = super::hash::sha256(locking_bytecode);
    h.reverse();
    hex::encode(h)
}
