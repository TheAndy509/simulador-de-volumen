"""Pruebas del backend: parser, cálculo del volumen, API y seguridad.

Ejecutar desde la raíz del proyecto:  python -m pytest
"""
import math

import pytest

from app import app, parse_fn, _normalize


@pytest.fixture
def client():
    app.config['TESTING'] = True
    return app.test_client()


def calc(client, **data):
    data.setdefault('a', 0)
    data.setdefault('b', 1)
    data.setdefault('axis', 'x')
    data.setdefault('method', 'washer' if 'g' in data else 'disk')
    return client.post('/api/calc', json=data)


# ─── Volúmenes conocidos (los ejemplos del README) ─────────────────────────────
@pytest.mark.parametrize('data, expected', [
    (dict(f='√(x)', a=0, b=4), 8 * math.pi),
    (dict(f='√(x)', g='x/2', a=0, b=4), 8 * math.pi / 3),
    (dict(f='x^2 + 3', g='x + 5', a=-1, b=2), 41.4 * math.pi),
    # Funciones al revés: el radio exterior se detecta solo.
    (dict(f='x/2', g='√(x)', a=0, b=4), 8 * math.pi / 3),
    # Esfera de radio 2: (4/3)π·2³
    (dict(f='sqrt(4 - x^2)', a=-2, b=2), 32 * math.pi / 3),
    # Cono de radio 1 y altura 3: (1/3)π·1²·3
    (dict(f='(1/3)x', a=0, b=3), math.pi),
    (dict(f='sen(x)', a=0, b=math.pi), math.pi ** 2 / 2),
])
def test_volumenes_conocidos(client, data, expected):
    r = calc(client, **data)
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body['volume'] == pytest.approx(expected, rel=1e-6)
    assert body['volume_pi'] == pytest.approx(expected / math.pi, rel=1e-6)


def test_eje_y_usa_la_variable_y(client):
    r = calc(client, f='√(y)', a=0, b=4, axis='y')
    assert r.status_code == 200
    assert r.get_json()['volume'] == pytest.approx(8 * math.pi, rel=1e-6)


def test_respuesta_trae_los_datos_para_la_geometria(client):
    body = calc(client, f='√(x)', g='x/2', a=0, b=4).get_json()
    assert len(body['xs']) == len(body['outer_r']) == len(body['inner_r']) == 300
    assert all(R >= r for R, r in zip(body['outer_r'], body['inner_r']))
    assert calc(client, f='x').get_json()['inner_r'] is None


def test_eje_invalido_se_trata_como_x(client):
    assert calc(client, f='x', axis='z').get_json()['axis'] == 'x'


# ─── Parser ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize('entrada, esperado', [
    ('2x² + sen(x)', '2*x**2 + sin(x)'),
    ('(1/8)x', '(1/8)*x'),
    ('arcsen(x)', 'asin(x)'),
    ('√(x)', 'sqrt(x)'),
    ('x^3', 'x**3'),
])
def test_normalize(entrada, esperado):
    assert _normalize(entrada) == esperado


@pytest.mark.parametrize('expr, t, valor', [
    ('x^2', 3, 9),
    ('2x', 5, 10),
    ('ln(e)', 0, 1),
    ('abs(t)', -2, 2),
    ('3', 100, 3),
])
def test_parse_fn_evalua(expr, t, valor):
    assert float(parse_fn(expr)(t)) == pytest.approx(valor)


# ─── Mensajes de error ─────────────────────────────────────────────────────────
@pytest.mark.parametrize('data, fragmento', [
    (dict(f='x', a=2, b=1), 'a < b'),
    (dict(f='x', a='abc'), 'deben ser números'),
    (dict(f='x', a='inf'), 'finitos'),
    (dict(f=''), 'Escribe una función'),
    (dict(f='2+'), 'incompleta o mal escrita'),
    (dict(f='sen()'), 'incompleta o mal escrita'),
    (dict(f='(x+1'), 'Falta cerrar un paréntesis'),
    (dict(f='x+1)'), 'no cierra ningún paréntesis'),
    (dict(f='sin'), 'entre paréntesis'),
    (dict(f='x*y'), 'una sola variable'),
    (dict(f='foo(x)'), 'Nombre no permitido'),
    (dict(f='x', g='(x'), 'En g(x)'),
    (dict(f='y+', axis='y'), 'En f(y)'),
])
def test_errores_claros(client, data, fragmento):
    r = calc(client, **data)
    assert r.status_code == 400
    assert fragmento in r.get_json()['error']


def test_peticion_sin_json(client):
    r = client.post('/api/calc', data='hola')
    assert r.status_code == 400
    assert 'JSON' in r.get_json()['error']


# ─── Seguridad ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize('payload', [
    '__import__("os").getcwd() and x',
    'x.__class__',
    "eval('1')",
    'x[0]',
    'lambda: x',
])
def test_rechaza_codigo_python(client, payload):
    r = calc(client, f=payload)
    assert r.status_code == 400
    assert 'no permitido' in r.get_json()['error']


def test_rechaza_expresiones_muy_largas(client):
    r = calc(client, f='x+' * 150 + 'x')
    assert r.status_code == 400
    assert 'demasiado larga' in r.get_json()['error']


def test_potencia_enorme_no_congela_el_servidor(client):
    r = calc(client, f='9**9**9')
    assert r.status_code == 200

