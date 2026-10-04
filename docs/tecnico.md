# Documentación técnica

Este documento explica cómo funciona el simulador por dentro: las matemáticas, la API entre el frontend y el backend, y las decisiones de seguridad. Para instalarlo y usarlo, consulta el [README](../README.md).

## 1. Matemáticas

### Método de disco

Si una región bajo la curva y = f(x), entre x = a y x = b, gira alrededor del eje X, cada corte perpendicular al eje es un círculo de radio f(x). Su área es π·f(x)², y sumando (integrando) esas áreas a lo largo del intervalo se obtiene el volumen:

```
V = π ∫ₐᵇ [f(x)]² dx
```

### Método de anillo (arandela)

Si la región está entre dos curvas, cada corte es una corona circular con radio exterior R(x) y radio interior r(x). Su área es π·(R² − r²), así que:

```
V = π ∫ₐᵇ ( [R(x)]² − [r(x)]² ) dx
```

En el código el integrando es `|f(t)² − g(t)²|`. El valor absoluto hace que el resultado sea correcto aunque el usuario escriba las funciones en el orden contrario, o aunque cuál es mayor cambie dentro del intervalo: en cada punto, |f² − g²| es igual a (mayor)² − (menor)².

Para rotar alrededor del eje Y se usan las mismas fórmulas con y como variable: la interfaz pide f(y) y el parser acepta cualquier letra como variable.

### Integración numérica

El volumen se calcula con `scipy.integrate.quad`, que usa cuadratura adaptativa: divide el intervalo con más detalle donde la función cambia más rápido y estima su propio error. Se le permite subdividir hasta 500 veces (`limit=500`).

Si `quad` lanza una excepción, el código usa como respaldo la **regla de Simpson** con N = 2000 subintervalos:

```
∫ₐᵇ h(t) dt ≈ (Δt / 3) · [ h(t₀) + 4h(t₁) + 2h(t₂) + 4h(t₃) + … + h(t_N) ]
```

### Puntos problemáticos

Cada evaluación pasa por la función `ev()`, que devuelve 0 si el resultado es infinito o NaN, o si la evaluación falla. Por ejemplo, f(x) = ln(x) no está definida en x = 0, pero el simulador calcula igualmente el volumen en [0, 1]: da 2π, que coincide con el valor exacto de π ∫₀¹ (ln x)² dx.

### Geometría 3D

El backend muestrea 300 puntos equiespaciados del intervalo y devuelve el radio exterior e interior en cada uno. Con eso, el frontend:

- Construye la **superficie de revolución** girando cada punto (t, r) en 60 pasos alrededor del eje y uniendo los anillos con triángulos (`buildRevSurface`).
- Dibuja los **discos o anillos** como cilindros, huecos en el caso del anillo, con el radio evaluado en el centro de cada uno.
- Calcula el radio en cualquier posición intermedia, por ejemplo en la sección del deslizador, con **interpolación lineal** entre los dos puntos muestreados más cercanos (`interpR`).

Para que la vista siga fluida con 80 discos, sus geometrías se fusionan en unas pocas mallas (`mergeGeometries`). Así la GPU recibe 4 llamadas de dibujo en lugar de cientos. Cada disco conserva su color porque el color va guardado en cada vértice (`colorize`).

## 2. API

El frontend y el backend se comunican con un único endpoint.

### `POST /api/calc`

**Cuerpo de la petición (JSON):**

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `f` | texto | sí | Función del radio exterior, p. ej. `"sqrt(x)"` |
| `g` | texto | solo para anillo | Función del radio interior |
| `a`, `b` | número | sí | Extremos del intervalo; debe cumplirse a < b |
| `method` | texto | no | `"disk"` (por defecto) o `"washer"` |
| `axis` | texto | no | `"x"` (por defecto) o `"y"`; cualquier otro valor se trata como `"x"` |

**Ejemplo:**

```json
{ "method": "washer", "axis": "x", "a": 0, "b": 4, "f": "sqrt(x)", "g": "x/2" }
```

**Respuesta correcta (200).** Los arreglos de muestras tienen 300 elementos; aquí se muestran solo los tres primeros:

```json
{
  "volume": 8.377580409572783,
  "volume_pi": 2.666666666666667,
  "formula": "V = π ∫<sub>0.0</sub><sup>4.0</sup> [f(x)]² − [g(x)]²  dx<br>…",
  "axis": "x",
  "a": 0.0,
  "b": 4.0,
  "xs":      [0.0, 0.01338, 0.02676, …],
  "outer_r": [0.0, 0.11566, 0.16357, …],
  "inner_r": [0.0, 0.00669, 0.01338, …]
}
```

`volume_pi` es el volumen dividido entre π (en el ejemplo, 8/3). `inner_r` es `null` en el método de disco.

**Respuesta con error (400):**

```json
{ "error": "Carácter no permitido: «_»" }
```

Se devuelve cuando a ≥ b, cuando la función no pasa la validación, cuando tiene más de una variable o cuando no se puede interpretar. El frontend muestra el mensaje tal cual.

## 3. Seguridad

### El problema

SymPy convierte texto en expresiones matemáticas con `sympify()`, que internamente usa `eval()` de Python. La propia documentación de SymPy advierte que no debe usarse con entradas no confiables. En la versión original, el texto del campo de función llegaba directo a `sympify()`, así que una "función" como esta:

```
__import__("os").getcwd() and x
```

ejecutaba código Python en el servidor y devolvía un volumen como si nada. Con la misma técnica se podían leer o borrar archivos, o abrir una conexión remota.

Había además un problema de **denegación de servicio**: con una expresión como `9**9**9`, SymPy intenta calcular el entero exacto, que tiene cientos de millones de dígitos, y el servidor deja de responder.

### La corrección

**1. Validación por tokens antes de `sympify()`** (función `_validate`). La expresión ya normalizada se recorre pieza por pieza, y solo se aceptan:

- números (`3`, `1.5`, `.25`);
- los operadores `+ - * / **` y los paréntesis;
- los nombres de la lista `_LOCALS` (`sin`, `sqrt`, `log`, `pi`…);
- variables de una sola letra minúscula.

Es una **lista blanca**: en lugar de intentar adivinar todo lo peligroso, se define lo poco que está permitido y se rechaza el resto. Sin `_`, `.`, comillas, corchetes ni comas, no hay forma de acceder a atributos de objetos, importar módulos ni llamar funciones de Python. También se limita la longitud a 200 caracteres.

**2. Evaluación con decimales.** La expresión se interpreta con `evaluate=False` y todos los números se convierten a `Float` antes de compilarla. Así, `9**9**9` da infinito al instante en lugar de intentar un cálculo exacto, y `ev()` lo trata como 0.

### Verificación

| Entrada | Antes | Después |
|---|---|---|
| `__import__("os").getcwd() and x` | Ejecutaba código en el servidor | Error 400: «Carácter no permitido: «_»» |
| `9**9**9` | El servidor dejaba de responder | Responde al instante |
| `sqrt(x)` y `x/2` en [0, 4] | 8π/3 | 8π/3 (sin cambios) |

### Otras medidas

- **Debug desactivado:** el depurador de Flask permite ejecutar código desde el navegador si está expuesto. Solo se activa con la variable de entorno `FLASK_DEBUG=1`.
- **Escape de HTML:** la fórmula que se muestra en pantalla incluye el texto de la función, así que se pasa por `html.escape` antes de insertarla, para evitar XSS. Los mensajes de error se muestran con `textContent`, que nunca interpreta HTML.
- **Validación del eje:** el valor de `axis` que envía el cliente se limita a `"x"` o `"y"`.
- **Sin dependencias externas en tiempo de ejecución:** Three.js está incluido en `static/vendor`, en lugar de cargarse desde un CDN.
- **Solo localhost:** el lanzador de escritorio escucha en `127.0.0.1`, de modo que no es accesible desde otras máquinas de la red.

## 4. Limitaciones conocidas

- Si la expresión tiene un error de sintaxis (por ejemplo `2+`), el mensaje que se muestra es el error técnico de SymPy, no uno pensado para el usuario.
- Cuando hay un error, el panel sigue mostrando el resultado del cálculo anterior.
- El campo `n` (número de discos) se envía al backend pero no se usa allí: el número de discos solo afecta a la visualización, nunca al cálculo del volumen.
- El ejecutable solo se genera para Windows.

---

Autor: **Anndré** · [@TheAndy509](https://github.com/TheAndy509)
