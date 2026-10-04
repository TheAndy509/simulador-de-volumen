import os
import re
from html import escape
from flask import Flask, request, jsonify, render_template
import numpy as np
from scipy.integrate import quad
from sympy import sympify, lambdify, symbols, Float, Rational, sqrt, sin, cos, tan, exp, log, Abs, pi, E, asin, acos, atan, sinh, cosh, tanh

app = Flask(__name__)

_x = symbols('x')
_LOCALS = {
    'sqrt': sqrt, 'sin': sin, 'cos': cos, 'tan': tan,
    'arcsin': asin, 'arccos': acos, 'arctan': atan,
    'asin': asin, 'acos': acos, 'atan': atan,
    'sinh': sinh, 'cosh': cosh, 'tanh': tanh,
    'exp': exp, 'log': log, 'ln': log, 'abs': Abs,
    'pi': pi, 'e': E,
}


_SUPERSCRIPTS = {
    '⁰':'**0','¹':'**1','²':'**2','³':'**3','⁴':'**4',
    '⁵':'**5','⁶':'**6','⁷':'**7','⁸':'**8','⁹':'**9',
}

def _normalize(expr: str) -> str:
    for ch, rep in _SUPERSCRIPTS.items():
        expr = expr.replace(ch, rep)
    expr = expr.replace('^', '**')
    expr = expr.replace('arcsen(', 'asin(')  # Spanish arc-sine
    expr = expr.replace('sen(', 'sin(')      # Spanish sine
    expr = expr.replace('√', 'sqrt')
    expr = re.sub(r'(\d)([a-zA-Z(])', r'\1*\2', expr)
    expr = re.sub(r'(\))(\d)', r'\1*\2', expr)
    expr = re.sub(r'(\))([a-zA-Z(])', r'\1*\2', expr)  # (1/8)x → (1/8)*x
    return expr


def _pretty(expr: str) -> str:
    s = expr.replace('sqrt(', '√(').replace('sqrt ', '√')
    s = s.replace('sin(', 'sen(')
    s = s.replace('**', '^')
    return s


# ─── Validación de la entrada ───────────────────────────────────────────────
# sympify() usa eval() internamente, así que antes de llamarlo se comprueba que
# la expresión solo contenga números, operadores, paréntesis, funciones
# permitidas y variables de una letra. Sin «_», «.», comillas ni corchetes no
# hay forma de acceder a atributos ni de importar módulos.
_TOKEN_RE = re.compile(r'\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z]+)|(\*\*|[+\-*/()]))')
_MAX_LEN = 200


def _validate(expr: str) -> None:
    if len(expr) > _MAX_LEN:
        raise ValueError(f'La expresión es demasiado larga (máximo {_MAX_LEN} caracteres)')
    pos = 0
    while pos < len(expr):
        if expr[pos:].strip() == '':
            break
        m = _TOKEN_RE.match(expr, pos)
        if not m:
            raise ValueError(f'Carácter no permitido: «{expr[pos]}»')
        name = m.group(2)
        if name and name not in _LOCALS and not re.fullmatch(r'[a-z]', name):
            raise ValueError(f'Nombre no permitido: «{name}»')
        pos = m.end()


def parse_fn(expr: str):
    expr = _normalize(expr)
    _validate(expr)
    # evaluate=False + números como Float: evita que algo como 9**9**9 se
    # calcule como entero exacto y congele el servidor; con floats da inf.
    sym = sympify(expr, locals=_LOCALS, evaluate=False)
    sym = sym.xreplace({n: Float(n) for n in sym.atoms(Rational)})
    free = sym.free_symbols
    if len(free) > 1:
        names = ', '.join(sorted(str(s) for s in free))
        raise ValueError(f'La expresión debe tener una sola variable (se encontraron: {names})')
    # Accept whichever variable letter the user actually typed (x, y, t, ...)
    # instead of forcing "x" — the UI asks for f(y) when the axis is y, so the
    # parser must bind to that symbol rather than silently evaluating to 0.
    var = free.pop() if free else _x
    return lambdify(var, sym, modules='numpy')


def ev(fn, t):
    try:
        v = float(fn(t))
        return v if np.isfinite(v) else 0.0
    except Exception:
        return 0.0


def calc_volume(fn, gn, a, b):
    if gn:
        # Use abs so the formula works regardless of which function is larger
        integrand = lambda t: abs(ev(fn, t) ** 2 - ev(gn, t) ** 2)
    else:
        integrand = lambda t: ev(fn, t) ** 2
    try:
        raw, _ = quad(integrand, a, b, limit=500)
    except Exception:
        N = 2000
        h = (b - a) / N
        raw = sum(
            integrand(a + i * h) * (1 if i in (0, N) else 4 if i % 2 else 2)
            for i in range(N + 1)
        ) * h / 3
    return np.pi * raw


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/calc', methods=['POST'])
def calc():
    d = request.json
    try:
        method = d.get('method', 'disk')
        axis   = d.get('axis', 'x')
        if axis not in ('x', 'y'):
            axis = 'x'
        a, b   = float(d['a']), float(d['b'])
        n      = max(2, min(100, int(d.get('n', 20))))
        f_str  = d['f'].strip()
        g_str  = d.get('g', '').strip()

        if a >= b:
            return jsonify({'error': 'Se requiere a < b'}), 400

        fn = parse_fn(f_str)
        gn = parse_fn(g_str) if (method == 'washer' and g_str) else None

        # 300 sample points for geometry + marker interpolation
        xs = np.linspace(a, b, 300).tolist()
        f_vals = [abs(ev(fn, xi)) for xi in xs]
        g_vals = [abs(ev(gn, xi)) for xi in xs] if gn else None

        # Ensure outer_r >= inner_r at every point (swap if user entered them reversed)
        if g_vals:
            outer_r = [max(f, g) for f, g in zip(f_vals, g_vals)]
            inner_r = [min(f, g) for f, g in zip(f_vals, g_vals)]
        else:
            outer_r = f_vals
            inner_r = None

        vol = calc_volume(fn, gn, a, b)

        if gn:
            formula = (f"V = π ∫<sub>{a}</sub><sup>{b}</sup>"
                       f" [f({axis})]² − [g({axis})]²  d{axis}"
                       f"<br><small style='color:#a0aec0'>"
                       f"f({axis}) = {escape(_pretty(f_str))} &nbsp;·&nbsp; g({axis}) = {escape(_pretty(g_str))}"
                       f"</small>")
        else:
            formula = (f"V = π ∫<sub>{a}</sub><sup>{b}</sup>"
                       f" [f({axis})]²  d{axis}"
                       f"<br><small style='color:#a0aec0'>f({axis}) = {escape(_pretty(f_str))}</small>")

        return jsonify({
            'volume':    float(vol),
            'volume_pi': float(vol / np.pi),
            'formula':   formula,
            'axis':      axis,
            'a': a, 'b': b,
            'xs':      xs,
            'outer_r': outer_r,
            'inner_r': inner_r,
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 400


if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG') == '1', port=5050)
