# I Will Betray You — ideas pendientes

Ideas que nos interesan como concepto y que hay que explorar en detalle antes
de implementar. Esfuerzo aproximado: **S** (horas), **M** (un par de
sesiones), **L** (varias sesiones, toca muchas piezas).

Hecho hasta ahora: provincias procedurales (F0), ataques por provincia con
barrida al 95 % (F1) y resaltado de provincias al pasar el ratón y en
ataques (F2), edificios de recurso (idea 1, abajo) y un panel arriba a la
derecha con el oro por minuto desglosado por fuente. El ritmo general se
ralentizará cuando estas mecánicas nuevas hagan que falte tiempo para
gestionarlo todo.

## 1. Rasgos de provincia (M) — hecho, como edificios de recurso

Decidido: los rasgos son **edificios de recurso** colocados al azar en cada
partida (8 % de las provincias por tipo, mínimo 2, sin máximo, nunca en
provincias vecinas ni en islas diminutas, ocultos durante la elección de
territorio). Quien conquista su casilla recibe el edificio; se capturan como
cualquier otro y una nuke los destruye para siempre. La IA les da prioridad.

- **Granja**: las casillas del dueño en esa provincia cuentan x2 para el
  máximo de tropas.
- **Mina**: oro por tick que crece con el nivel. Sube un nivel cada 2 minutos
  en poder del mismo dueño, sin tope; si la conquistan, vuelve al nivel 1.
  Curva (100, 150, 250, 400, 600…): cada nivel sube un "paso" más que el
  anterior. Unos 60k de oro/min al empezar, 360k a los 8 min, 1,1M a los 16 y
  2,4M a los 24. Si se queda floja, se sube mineStartGold.
- **Puerto natural**: puerto de nivel 1 gratis, no mejorable, que no encarece
  los demás puertos; icono propio.

Hechas las tres fases: colocación, edificios con sus efectos y la IA, que
puntúa x3 las provincias con recurso al elegir a cuál atacar. Los iconos son
provisionales hasta tener los definitivos. Todas las cifras están en
RESOURCE_SETTINGS (src/core/configuration/ProvinceConfig.ts).

Idea original:

Cada provincia tiene un rasgo visible, por ejemplo:

- **Fértil**: más tropas.
- **Rica**: más oro.
- **Montañosa**: más defensa.
- **Costera**: puertos más baratos.

Objetivo: que no todas las provincias valgan lo mismo y haya que elegir cuáles
atacar.

Por explorar: cómo se reparten (¿al azar, según el terreno?), cuánto pesa cada
bonificación, cómo se muestran en el mapa y si la IA los tiene en cuenta.

## 2. Fortificación que crece (M) — posiblemente sustituida por la 6

Una provincia que no se ataca durante un rato gana defensa poco a poco. Los
frentes estables significan algo y atacar por sorpresa compensa.

## 3. Niebla de guerra (L)

Solo ves el detalle de tus provincias y de las vecinas. Los ataques sorpresa y
las traiciones pegan mucho más.

Por explorar: qué se oculta exactamente (territorio, tropas, edificios,
unidades), cómo afecta al renderizado y cómo juega la IA sin ver todo el mapa.

## 4. Espías (M)

Una unidad o edificio que revela las tropas y los planes de otro jugador
durante un rato. Tiene mucho más sentido junto con la niebla de guerra (3).

## 5. Alertas en pantalla (S)

Avisos como "te atacan en [provincia]", con un clic para ir allí. Queda mucho
mejor con nombres de provincia.

## 6. Tropas permanentes en un frente (propuesta propia; sustituiría a la 2)

Destinar tropas de forma permanente a un frente:

- Esas tropas salen del máximo de tropas del jugador (quedan congeladas).
- Protegen ese frente con una bonificación de defensa mayor que la de las
  tropas que simplemente salen a defender cuando te atacan.

Por explorar:

- ¿Qué es "un frente"? ¿Una provincia propia, la frontera con un país
  concreto, o un tramo de frontera?
- ¿Cuánto vale la bonificación y cómo se calcula (por tropa, por casilla de
  frontera)?
- ¿Qué pasa con esas tropas si el frente cae o deja de ser frontera?
  ¿Vuelven al total, se pierden en parte?
- ¿Pueden usarse para atacar desde ese frente?
- ¿Cómo se asignan y se ven en la interfaz, y cómo las usa la IA?
