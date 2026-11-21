function word_to_u32(w) {
  let x = 0;
  for (let i = 0; w.$ === "WCon"; i++) {
    x |= Number(w.head) << i;
    w = w.tail;
  }
  return x >>> 0;
}

function u32_to_word(x) {
  let w = {$: "WNil"};
  for (let i = 31; i >= 0; i--) {
    w = {$: "WCon", head: ((x >>> i) & 1) === 1, tail: w};
  }
  return w;
}

function cmp_new(a, b) {
  return {$: a < b ? "LT" : a === b ? "EQ" : "GT"};
}

function tup_new(a, b) {
  return {$: "Tuple", fst: a, snd: b};
}

function nat_divmod(a, b) {
  return tup_new(b && Math.trunc(a / b), b ? a % b : a);
}

function nat_chk(n) {
  if (n > 281474976710655) {
    throw "bend: a Nat past the largest immediate 2^48-1";
  }
  return n;
}

function nat_in(n) {
  if (!Number.isInteger(n) || n < 0 || n > 2 ** 53) {
    throw "bend: expected a Nat host number: an integer from 0 to 2^53";
  }
  return n;
}

function f32_show(x) {
  let s = "nan";
  for (let p = 1; x === x && p <= 9 && f32_round(s) !== x; p += 1) {
    s = String(Number(x.toExponential(p - 1)));
  }
  return (Object.is(x, -0) ? "-0" : s).replace("Infinity", "inf");
}

function f32_bits(x) {
  return new Uint32Array(new Float32Array([x]).buffer)[0];
}

function f32_from_bits(u) {
  return new Float32Array(new Uint32Array([u]).buffer)[0];
}

function f32_read(s) {
  const re = /^[\t\n\v\f\r ]*[+-]?((\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?|inf(inity)?|nan)$/i;
  return re.test(s) ? {$: "Some", value: f32_round(
    s.replace(/inf\w*/i, "Infinity"))} : {$: "None"};
}

const f32_round = function f32_round(s) {
  const d = Number(s);
  const a = Math.abs(d);
  const f = Math.fround(a);
  const g = 2 * a - Math.min(f, 2 ** 128);
  if (g === f || Math.fround(g) !== g || g === Infinity) {
    return Math.sign(d) * f;
  }
  let k = 0;
  while (a * 2 ** k % 1 !== 0) {
    k += 1;
  }
  const [, i, r, e] = /(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(s);
  const n = Number(e ?? 0) - r.length;
  const x = BigInt(i + r) * 2n ** BigInt(k) * 10n ** BigInt(Math.max(n, 0));
  const y = BigInt(a * 2 ** k) * 10n ** BigInt(Math.max(-n, 0));
  return Math.sign(d) * (x === y || x > y !== g > f ? f : g);
};

const char_new = function char_new(c) {
  return c < 55296 || c >= 57344 && c <= 1114111 ? String.fromCodePoint(c) : String.fromCharCode(56320, c >>> 22, c >>> 11 & 2047, c & 2047);
};

function char_len(s, at = 0) {
  return s[at] === "\uDC00" ? 4 : s.codePointAt(at) > 0xFFFF ? 2 : 1;
}

function char_code(s) {
  return s.length < 4 ? s.codePointAt(0)
    : (s.charCodeAt(1) << 22 | s.charCodeAt(2) << 11 | s.charCodeAt(3)) >>> 0;
}

function string_contains(s, p) {
  // A match starts at a Char, not inside a packed U32 code.
  for (let at = 0; at <= s.length; at += char_len(s, at)) {
    if (s.startsWith(p, at)) {
      return true;
    }
  }
  return false;
}

function str_out(s) {
  return s.replace(/\uDC00[^]{3}/gu, "\uFFFD");
}

function str_in(s) {
  return s.replace(/\p{Cs}/gu, "\uFFFD");
}

// Array
// =====

function array_new(d, v, lgs) {
  if (d > 31 - lgs) {
    throw "bend: an array past the deepest block class 31 (depth + log2 words per cell)";
  }
  return Array(2 ** d).fill(v);
}

function array_node(a, b) {
  if (a.length !== b.length) {
    throw "bend: runtime fail-stop";
  }
  return a.concat(b);
}

function array_rmw(a, i, f) {
  const old = a[i %= a.length];
  a[i] = f(old);
  return tup_new(a, old);
}

// Run
// ===

function run_tail(f, x) {
  return {$: "$JMP", f: f.j?.f === f ? f.j : f, x};
}

function run_clo(j) {
  const f = (x) => run_loop(j(x));
  f.j = j;
  j.f = f;
  return f;
}

function run_loop(r) {
  while (r !== null && typeof r === "object" && r.$ === "$JMP") {
    r = r.f(r.x);
  }
  return r;
}

function run_lib(f, n) {
  return (...a) => a.length < n ? run_lib((...b) => f(...a, ...b), n - a.length)
    : run_loop(f(...a));
}

// Effect
// ======

const $0eff = Object.create(null);
const io_file_append = new Set();

function io_eff(k, run) {
  if (arguments.length > 2) {
    throw new Error("bend: " + k + " takes no need: an effect that waits parks itself");
  }
  if (k in $0eff) {
    throw new Error("bend: two effects register " + k);
  }
  $0eff[k] = run;
}
// Program
// =======

function $keep_first(_found_0, _fallback_0, _rest_0) {
  if (_found_0) {
    return {$: "Some", "value": _fallback_0};
  } else {
    return _rest_0;
  }
}

function $fallback_of(_policy_0, _pool_0) {
  if (_policy_0.$ === "Nil") {
    return {$: "None"};
  } else {
    const _t_0 = _policy_0["head"];
    const _p_0 = _t_0["pool"];
    const _fallback_0 = _t_0["fallback"];
    const _rest_0 = _policy_0["tail"];
    return $keep_first($$Nat_is_eq(_p_0, _pool_0), _fallback_0, $$fallback_of(_rest_0, _pool_0));
  }
}

function $empty() {
  return {$: "Nil"};
}

function $record(_parked_0, _refusal_0) {
  return {$: "Con", "head": _refusal_0, "tail": _parked_0};
}

function $record_all($0, $1) {
  for (;;) {
    {
      const _refusals_0 = $0;
      const _parked_0 = $1;
      if (_refusals_0.$ === "Nil") {
        return _parked_0;
      } else {
        const _refusal_0 = _refusals_0["head"];
        const _rest_0 = _refusals_0["tail"];
        $0 = _rest_0;
        $1 = $$record(_parked_0, _refusal_0);
        continue;
      }
    }
  }
}

function $no_reset_parking() {
  return (900000 );
}

function $parks_until(_refusal_0) {
  const _refused_at_0 = _refusal_0["refused_at"];
  const _t_0 = _refusal_0["reset"];
  if (_t_0.$ === "None") {
    const _x_0 = $$no_reset_parking();
    return nat_chk(_refused_at_0 + _x_0);
  } else {
    const _reset_0 = _t_0["value"];
    return _reset_0;
  }
}

function $is_for(_refusal_0, _login_0, _model_0) {
  const _l_0 = _refusal_0["login"];
  const _m_0 = _refusal_0["model"];
  return $Bool_and($$Nat_is_eq(_l_0, _login_0), $$Nat_is_eq(_m_0, _model_0));
}

function $reset_if(_own_0, _reset_0) {
  if (_own_0) {
    return {$: "Some", "value": _reset_0};
  } else {
    return {$: "None"};
  }
}

function $later(_a_0, _b_0) {
  if (_a_0.$ === "None") {
    return _b_0;
  } else {
    const _x_0 = _a_0["value"];
    if (_b_0.$ === "None") {
      return {$: "Some", "value": _x_0};
    } else {
      const _y_0 = _b_0["value"];
      return {$: "Some", "value": (_x_0 > _y_0 ? _x_0 : _y_0)};
    }
  }
}

function $latest_reset(_parked_0, _login_0, _model_0) {
  if (_parked_0.$ === "Nil") {
    return {$: "None"};
  } else {
    const _refusal_0 = _parked_0["head"];
    const _rest_0 = _parked_0["tail"];
    return $later($$reset_if($$is_for(_refusal_0, _login_0, _model_0), $$parks_until(_refusal_0)), $$latest_reset(_rest_0, _login_0, _model_0));
  }
}

function $reset_if_after(_latest_0, _now_0) {
  if (_latest_0.$ === "None") {
    return {$: "None"};
  } else {
    const _reset_0 = _latest_0["value"];
    return $reset_if((_now_0 < _reset_0), _reset_0);
  }
}

function $parkedUntil(_parked_0, _login_0, _model_0, _now_0) {
  return $reset_if_after($$latest_reset(_parked_0, _login_0, _model_0), _now_0);
}

function $decide_parked(_fallback_0, _until_0) {
  if (_until_0.$ === "Some") {
    const _reset_0 = _until_0["value"];
    return {$: "Divert", "pool": _fallback_0, "reset": _reset_0};
  } else {
    return {$: "Keep"};
  }
}

function $decide_logged_in(_fallback_0, _until_0) {
  if (_fallback_0.$ === "None") {
    return {$: "Keep"};
  } else {
    const _f_0 = _fallback_0["value"];
    return $decide_parked(_f_0, _until_0);
  }
}

function $decide(_policy_0, _parked_0, _request_0, _now_0) {
  const _pool_0 = _request_0["pool"];
  const _t_0 = _request_0["login"];
  if (_t_0.$ === "None") {
    return {$: "Keep"};
  } else {
    const _login_0 = _t_0["value"];
    const _model_1 = _request_0["model"];
    return $decide_logged_in($$fallback_of(_policy_0, _pool_0), $$parkedUntil(_parked_0, _login_0, _model_1, _now_0));
  }
}

function $Nat_is_eq(_a_0, _b_0) {
  return $Cmp_is_eq(cmp_new(_a_0, _b_0));
}

function $Bool_and(_a_0, _b_0) {
  if (!_a_0) {
    return false;
  } else {
    return _b_0;
  }
}

function $Cmp_is_eq(_c_0) {
  if (_c_0.$ === "EQ") {
    return true;
  } else {
    return false;
  }
}

const $$Nat_is_eq = $Nat_is_eq;
const $$fallback_of = $fallback_of;
const $$record = $record;
const $$no_reset_parking = $no_reset_parking;
const $$is_for = $is_for;
const $$parks_until = $parks_until;
const $$reset_if = $reset_if;
const $$latest_reset = $latest_reset;
const $$parkedUntil = $parkedUntil;export default {
  "keep_first": run_lib((a0,a1,a2) => run_loop($keep_first(a0,nat_in(a1),a2)), 3),
  "fallback_of": run_lib((a0,a1) => run_loop($fallback_of(a0,nat_in(a1))), 2),
  "empty": run_lib(() => run_loop($empty()), 0),
  "record": run_lib((a0,a1) => run_loop($record(a0,a1)), 2),
  "record_all": run_lib((a0,a1) => run_loop($record_all(a0,a1)), 2),
  "no_reset_parking": run_lib(() => run_loop($no_reset_parking()), 0),
  "parks_until": run_lib((a0) => run_loop($parks_until(a0)), 1),
  "is_for": run_lib((a0,a1,a2) => run_loop($is_for(a0,nat_in(a1),nat_in(a2))), 3),
  "reset_if": run_lib((a0,a1) => run_loop($reset_if(a0,nat_in(a1))), 2),
  "later": run_lib((a0,a1) => run_loop($later(a0,a1)), 2),
  "latest_reset": run_lib((a0,a1,a2) => run_loop($latest_reset(a0,nat_in(a1),nat_in(a2))), 3),
  "reset_if_after": run_lib((a0,a1) => run_loop($reset_if_after(a0,nat_in(a1))), 2),
  "parkedUntil": run_lib((a0,a1,a2,a3) => run_loop($parkedUntil(a0,nat_in(a1),nat_in(a2),nat_in(a3))), 4),
  "decide.parked": run_lib((a0,a1) => run_loop($decide_parked(nat_in(a0),a1)), 2),
  "decide.logged_in": run_lib((a0,a1) => run_loop($decide_logged_in(a0,a1)), 2),
  "decide": run_lib((a0,a1,a2,a3) => run_loop($decide(a0,a1,a2,nat_in(a3))), 4),
};
