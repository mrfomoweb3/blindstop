//! Blindstop enclave core: everything the OutLayer component does, as pure functions over a
//! [`tick::Host`]. The wasm (`enclave/room`) binds `Host` to OutLayer; the harness and the
//! tests bind it to fixtures.

pub mod decimal;
pub mod near;
pub mod order;
pub mod report;
pub mod seal;
pub mod tick;
pub mod trigger;

pub mod hl {
    pub mod api;
    pub mod msgpack;
    pub mod signing;
}
