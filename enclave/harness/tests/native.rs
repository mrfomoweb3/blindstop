//! The harness scenarios against the native core (fast; part of `make test`).
use blindstop_harness::{keystore, native::NativeEnclave, run_all, CONTRACT};

#[test]
fn all_scenarios_native() {
    let mut e = NativeEnclave::new(keystore(), CONTRACT);
    let log = run_all(&mut e);
    assert!(log.len() >= 12);
}
