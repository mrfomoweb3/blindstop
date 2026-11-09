//! Fixed-point decimals for prices and sizes. No floats touch anything that is sent to
//! Hyperliquid or compared against a trigger.
//!
//! A `Dec` is a non-negative value stored as an integer count of 10^-12 units.

use std::cmp::Ordering;
use std::fmt;

pub const SCALE_DIGITS: u32 = 12;
const SCALE: u128 = 1_000_000_000_000;
/// Largest integer part we accept (20 digits). Keeps every intermediate product in u128.
const MAX_INT_DIGITS: usize = 20;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Dec(u128);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rounding {
    Down,
    Up,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecError(pub String);

impl fmt::Display for DecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid decimal: {}", self.0)
    }
}

impl fmt::Debug for Dec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Dec({})", self.to_wire())
    }
}

impl fmt::Display for Dec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_wire())
    }
}

fn pow10(n: u32) -> u128 {
    10u128.pow(n)
}

fn digits(mut v: u128) -> u32 {
    if v == 0 {
        return 0;
    }
    let mut n = 0;
    while v > 0 {
        v /= 10;
        n += 1;
    }
    n
}

impl Dec {
    pub const ZERO: Dec = Dec(0);

    pub fn from_units(units: u128) -> Dec {
        Dec(units)
    }

    pub fn units(self) -> u128 {
        self.0
    }

    pub fn from_int(v: u64) -> Dec {
        Dec(v as u128 * SCALE)
    }

    pub fn is_zero(self) -> bool {
        self.0 == 0
    }

    /// Parse a plain non-negative decimal: `123`, `123.45`, `0.001`. No sign, no exponent,
    /// at most 12 fractional digits.
    pub fn parse(s: &str) -> Result<Dec, DecError> {
        if s.is_empty() {
            return Err(DecError("empty".into()));
        }
        let (int_s, frac_s) = match s.split_once('.') {
            Some((i, f)) => {
                if f.is_empty() {
                    return Err(DecError(format!("{s:?}: trailing dot")));
                }
                (i, f)
            }
            None => (s, ""),
        };
        if int_s.is_empty() {
            return Err(DecError(format!("{s:?}: missing integer part")));
        }
        if !int_s.bytes().all(|b| b.is_ascii_digit()) || !frac_s.bytes().all(|b| b.is_ascii_digit()) {
            return Err(DecError(format!("{s:?}: not a plain decimal")));
        }
        let int_trim = int_s.trim_start_matches('0');
        if int_trim.len() > MAX_INT_DIGITS {
            return Err(DecError(format!("{s:?}: too large")));
        }
        if frac_s.len() > SCALE_DIGITS as usize {
            return Err(DecError(format!("{s:?}: more than {SCALE_DIGITS} decimals")));
        }
        let int_v: u128 = if int_trim.is_empty() { 0 } else { int_trim.parse().map_err(|_| DecError(s.into()))? };
        let mut frac_v: u128 = if frac_s.is_empty() { 0 } else { frac_s.parse().map_err(|_| DecError(s.into()))? };
        frac_v *= pow10(SCALE_DIGITS - frac_s.len() as u32);
        Ok(Dec(int_v * SCALE + frac_v))
    }

    /// Parse a signed decimal such as Hyperliquid's `szi` ("-0.25"). Returns (negative, magnitude).
    pub fn parse_signed(s: &str) -> Result<(bool, Dec), DecError> {
        match s.strip_prefix('-') {
            Some(rest) => Dec::parse(rest).map(|d| (!d.is_zero(), d)),
            None => Dec::parse(s).map(|d| (false, d)),
        }
    }

    /// Hyperliquid wire format: shortest exact decimal, no trailing zeros, no trailing dot.
    /// Matches the Python SDK's `float_to_wire` (`Decimal(...).normalize()` then `:f`).
    pub fn to_wire(self) -> String {
        let int_part = self.0 / SCALE;
        let frac = self.0 % SCALE;
        if frac == 0 {
            return int_part.to_string();
        }
        let mut f = format!("{:012}", frac);
        while f.ends_with('0') {
            f.pop();
        }
        format!("{int_part}.{f}")
    }

    /// Number of decimal places actually used (0..=12).
    pub fn decimals(self) -> u32 {
        let frac = self.0 % SCALE;
        if frac == 0 {
            return 0;
        }
        let mut f = frac;
        let mut trailing = 0;
        while f % 10 == 0 {
            f /= 10;
            trailing += 1;
        }
        SCALE_DIGITS - trailing
    }

    pub fn min(self, other: Dec) -> Dec {
        if self <= other {
            self
        } else {
            other
        }
    }

    /// Round to `decimals` places in the given direction.
    pub fn round_to(self, decimals: u32, dir: Rounding) -> Dec {
        if decimals >= SCALE_DIGITS {
            return self;
        }
        let step = pow10(SCALE_DIGITS - decimals);
        let down = self.0 / step * step;
        match dir {
            Rounding::Down => Dec(down),
            Rounding::Up => {
                if down == self.0 {
                    Dec(down)
                } else {
                    Dec(down + step)
                }
            }
        }
    }

    /// `self * num / den`, rounded in the given direction.
    pub fn mul_ratio(self, num: u128, den: u128, dir: Rounding) -> Dec {
        assert!(den > 0);
        let p = self.0.checked_mul(num).expect("decimal overflow");
        let q = p / den;
        let r = p % den;
        match dir {
            Rounding::Down => Dec(q),
            Rounding::Up => Dec(if r == 0 { q } else { q + 1 }),
        }
    }

    pub fn cmp_dec(self, other: Dec) -> Ordering {
        self.0.cmp(&other.0)
    }
}

/// Hyperliquid perp price rules: at most 5 significant figures and at most
/// `6 - szDecimals` decimals. Integer prices are always valid whatever their length.
/// `dir` picks which way to round (the close order rounds away from the mark, so it
/// stays marketable).
pub fn round_perp_px(px: Dec, sz_decimals: u32, dir: Rounding) -> Dec {
    const MAX_DECIMALS_PERP: u32 = 6;
    const SIG_FIGS: i64 = 5;
    let max_dec = MAX_DECIMALS_PERP.saturating_sub(sz_decimals) as i64;
    let int_part = px.0 / SCALE;
    let sig_dec: i64 = if int_part > 0 {
        SIG_FIGS - digits(int_part) as i64
    } else {
        // 0.000123 → 12 - digits(123_000_000) = 3 leading zeros → 3 + 5 decimals
        let leading_zeros = SCALE_DIGITS as i64 - digits(px.0) as i64;
        leading_zeros + SIG_FIGS
    };
    let decimals = sig_dec.clamp(0, max_dec) as u32;
    px.round_to(decimals, dir)
}

/// Sizes are rounded DOWN to the asset's `szDecimals`: never close more than asked.
pub fn round_size(sz: Dec, sz_decimals: u32) -> Dec {
    sz.round_to(sz_decimals, Rounding::Down)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Dec {
        Dec::parse(s).unwrap()
    }

    #[test]
    fn parse_and_wire_round_trip() {
        for (input, wire) in [
            ("0", "0"),
            ("95000", "95000"),
            ("95000.50", "95000.5"),
            ("0.001", "0.001"),
            ("00012.3400", "12.34"),
            ("0.000000000001", "0.000000000001"),
            ("123456789012345678.5", "123456789012345678.5"),
        ] {
            assert_eq!(d(input).to_wire(), wire, "{input}");
        }
    }

    #[test]
    fn parse_rejects_garbage() {
        for bad in ["", ".5", "5.", "-1", "1e5", "1.2.3", " 1", "1,5", "0.0000000000001", "+1", "NaN"] {
            assert!(Dec::parse(bad).is_err(), "{bad:?} should be rejected");
        }
        assert!(Dec::parse("123456789012345678901").is_err());
    }

    #[test]
    fn signed() {
        assert_eq!(Dec::parse_signed("-0.25").unwrap(), (true, d("0.25")));
        assert_eq!(Dec::parse_signed("1.5").unwrap(), (false, d("1.5")));
        assert_eq!(Dec::parse_signed("-0").unwrap(), (false, Dec::ZERO));
        assert_eq!(Dec::parse_signed("-0.0").unwrap(), (false, Dec::ZERO));
    }

    #[test]
    fn ordering() {
        assert!(d("95000.5") > d("95000.49"));
        assert!(d("0.1") < d("0.10001"));
        assert_eq!(d("1.0"), d("1"));
    }

    #[test]
    fn perp_price_rounding() {
        // BTC: szDecimals 5 → max 1 decimal; 5 sig figs dominate above 10k.
        assert_eq!(round_perp_px(d("74439.09"), 5, Rounding::Down).to_wire(), "74439");
        assert_eq!(round_perp_px(d("74439.09"), 5, Rounding::Up).to_wire(), "74440");
        // Integer prices beyond 5 sig figs are allowed as-is.
        assert_eq!(round_perp_px(d("123456"), 5, Rounding::Down).to_wire(), "123456");
        assert_eq!(round_perp_px(d("123456.7"), 5, Rounding::Up).to_wire(), "123457");
        // ETH: szDecimals 4 → max 2 decimals.
        assert_eq!(round_perp_px(d("1891.4567"), 4, Rounding::Down).to_wire(), "1891.4");
        assert_eq!(round_perp_px(d("3.456789"), 4, Rounding::Down).to_wire(), "3.45");
        // SOL: szDecimals 2 → max 4 decimals; 5 sig figs → 86.615 stays.
        assert_eq!(round_perp_px(d("86.6159"), 2, Rounding::Down).to_wire(), "86.615");
        // Small prices: 5 sig figs after leading zeros, capped by max decimals.
        assert_eq!(round_perp_px(d("0.0012345678"), 0, Rounding::Down).to_wire(), "0.001234");
        assert_eq!(round_perp_px(d("0.58594"), 1, Rounding::Up).to_wire(), "0.58594");
        assert_eq!(round_perp_px(d("0.585941"), 1, Rounding::Up).to_wire(), "0.58595");
        // Rounding up across a power of ten.
        assert_eq!(round_perp_px(d("99999.5"), 5, Rounding::Up).to_wire(), "100000");
    }

    #[test]
    fn size_rounding_is_down() {
        assert_eq!(round_size(d("0.123456"), 5).to_wire(), "0.12345");
        assert_eq!(round_size(d("1.999"), 0).to_wire(), "1");
        assert_eq!(round_size(d("0.009"), 2).to_wire(), "0");
    }

    #[test]
    fn ratios() {
        // 1% slippage on a sell: 75191 * 9900 / 10000 = 74439.09
        assert_eq!(d("75191").mul_ratio(9900, 10000, Rounding::Down).to_wire(), "74439.09");
        assert_eq!(d("1").mul_ratio(1, 3, Rounding::Up).to_wire(), "0.333333333334");
        assert_eq!(d("1").mul_ratio(1, 3, Rounding::Down).to_wire(), "0.333333333333");
    }

    #[test]
    fn decimals_count() {
        assert_eq!(d("1").decimals(), 0);
        assert_eq!(d("1.50").decimals(), 1);
        assert_eq!(d("0.000001").decimals(), 6);
    }
}
