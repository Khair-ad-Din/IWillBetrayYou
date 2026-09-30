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

## 3. Niebla de guerra (L) — hecho (rama fog-of-war)

Opción de partida "Niebla de guerra" (sí/no), como las demás de la sala. Sin
niebla todo funciona como ahora; los espías solo existen con niebla. Es solo
visual: cada cliente simula la partida entera, así que alguien con las
herramientas del navegador podría verlo todo (entre amigos da igual).

Cada provincia está, para cada jugador, en uno de tres estados:

- **Visible**: todo en vivo. Tus provincias, las vecinas, las de tus aliados,
  el radio de tus barcos de guerra, puertos y SAM, y las que haya descubierto
  un espía (para toda la partida).
- **Recuerdo**: la viste y dejaste de verla (perdiste la frontera, un aliado
  te traicionó). Se queda congelada como la viste, con velo gris: dueño y
  edificios.
- **Desconocida**: sin dueño aparente y cubierta por una niebla de nubes que
  se mueve despacio (lo recordado lleva un velo gris rayado).

Aliarse comparte visión; traicionar la corta de golpe. Las provincias
separadas por un río o un estrecho de hasta 10 casillas de agua cuentan como
vecinas (FOG_SETTINGS.neighborWaterGap).

Reglas:

- **Conocer un país**: en cuanto ves una casilla suya. Los países
  desconocidos no salen en listas y no puedes aliarte con ellos ni espiarlos.
- **Clasificación**: solo lo que sabes; lo demás "??".
- **Tropas de otros**: nunca la cifra real, solo una estimación "~X": el
  máximo de tropas que daría la tierra que conoces de ellos (sus casillas,
  las granjas y ciudades conocidas). Las tropas de sus ataques y barcos salen
  como "??". El oro, siempre "??".
- **Registro de eventos**: ya solo trae mensajes en los que participas. Los
  avisos de ataque dicen quién ataca (se revisará el registro entero más
  adelante).
- **Brillo de jugadores pequeños**: desactivado con niebla.
- **Clic en terreno desconocido**: el menú actúa como si fuera tierra de
  nadie. Se puede atacar a ciegas; la verdad se descubre al llegar.
- **Nukes**: se ven cuando pasan por tu visión. Si van a por ti, siempre.
- **Fase de elegir territorio**: se ve todo; la niebla empieza con la
  partida.
- **Tu panel de oro/min**: solo lo ve cada uno (ya es así).
- **IA**: lo ve todo (hace trampa) y debe seguir siendo igual de competente.

El recuerdo se guarda en la simulación, no solo en pantalla, para que no se
pierda al recargar (Ctrl+F5).

## 4. Espías (M) — hecho (rama fog-of-war)

Espía autónomo: eliges un país que conoces (botón "Espía" en su panel), lo
mandas y él solo va de provincia en provincia (no casilla a casilla),
cruzando el mar si hace falta. Empieza por las provincias de ese país más
cercanas a lo que ya conoces y avanza como un frente. Las provincias que
atraviesa de camino se ven mientras está en ellas (luego quedan en recuerdo).
En el mapa sale una etiqueta "Espía 45%" donde está.

- Cada provincia que termina queda **visible en vivo para el resto de la
  partida** (territorio, edificios, ataques, lo que pase en ella). Sin parte
  de tropas: las tropas de otros solo se estiman.
- Al acabar el país desaparece y libera su hueco. Si el país conquista
  provincias nuevas, hará falta otro espía para verlas.
- Detección por provincia investigada: si lo pillan muere (lo descubierto se
  conserva) y la víctima recibe "X te está espiando".
- Valores de partida, a ajustar jugando (SPY_SETTINGS): 15 s por provincia,
  2 s por provincia de camino, 100k de oro el primero y 50k más cada uno que
  mandes, máximo 3 a la vez, 2 % de detección, sin edificio necesario.
- La IA no usa espías por ahora.

Para más adelante: sabotaje (parar una mina, robar oro), contraespionaje,
inteligencia pasiva por barcos de comercio y trenes (revelar la provincia de
cada puerto o estación extranjera por la que pasan).

## 5. Alertas en pantalla (S)

Avisos como "te atacan en [provincia]", con un clic para ir allí. Queda mucho
mejor con nombres de provincia.

Hecho con los espías, en el registro de eventos: "X te estaba espiando: su
espía ha sido capturado", "Tu espía en X ha sido capturado" y "Tu espía en X
ha terminado". Los avisos de nukes ya existían.

Pendiente, para cuando se revise el registro de eventos entero: "te atacan en
el noroeste" con clic para ir allí.

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
