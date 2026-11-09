//! When does a hidden level fire? Hyperliquid's own TP/SL triggers use the mark price, and so
//! do we. Equality fires: a stop at 95,000 fires when mark prints 95,000.

use crate::decimal::Dec;

pub fn is_triggered(is_long: bool, is_stop_loss: bool, mark: Dec, trigger: Dec) -> bool {
    match (is_long, is_stop_loss) {
        (true, true) => mark <= trigger,   // long stop-loss: price fell to the level
        (true, false) => mark >= trigger,  // long take-profit: price rose to the level
        (false, true) => mark >= trigger,  // short stop-loss: price rose to the level
        (false, false) => mark <= trigger, // short take-profit: price fell to the level
    }
}

/// Closing a long sells; closing a short buys.
pub fn close_is_buy(is_long: bool) -> bool {
    !is_long
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Dec {
        Dec::parse(s).unwrap()
    }

    #[test]
    fn four_cases_with_edges() {
        let t = d("100");
        // long SL
        assert!(is_triggered(true, true, d("99.99"), t));
        assert!(is_triggered(true, true, d("100"), t));
        assert!(!is_triggered(true, true, d("100.01"), t));
        // long TP
        assert!(is_triggered(true, false, d("100.01"), t));
        assert!(is_triggered(true, false, d("100"), t));
        assert!(!is_triggered(true, false, d("99.99"), t));
        // short SL
        assert!(is_triggered(false, true, d("100.01"), t));
        assert!(is_triggered(false, true, d("100"), t));
        assert!(!is_triggered(false, true, d("99.99"), t));
        // short TP
        assert!(is_triggered(false, false, d("99.99"), t));
        assert!(is_triggered(false, false, d("100"), t));
        assert!(!is_triggered(false, false, d("100.01"), t));
    }

    #[test]
    fn close_direction() {
        assert!(!close_is_buy(true));
        assert!(close_is_buy(false));
    }
}
