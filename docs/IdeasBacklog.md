# I Will Betray You — ideas pendientes

Ideas que nos interesan como concepto y que hay que explorar en detalle antes
de implementar. Esfuerzo aproximado: **S** (horas), **M** (un par de
sesiones), **L** (varias sesiones, toca muchas piezas).

Hecho hasta ahora: provincias procedurales (F0), ataques por provincia con
barrida al 95 % (F1) y resaltado de provincias al pasar el ratón y en
ataques (F2). El ritmo general se ralentizará cuando estas mecánicas nuevas
hagan que falte tiempo para gestionarlo todo.

## 1. Rasgos de provincia (M)

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
