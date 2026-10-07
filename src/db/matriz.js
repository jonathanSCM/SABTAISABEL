/* Matriz talla × color: [{ talla, consumo, colores:[{ color, cant }] }].
   Es la fuente de verdad cuando existe; "curva" (total por talla) y "colores" (total por
   color) se derivan de ella para que todo lo que ya los usa (costeo, totales, listados)
   siga funcionando igual. */
function normalizarMatriz(m){
  if(!Array.isArray(m)) return [];
  return m.map(r => ({
    talla: String((r && r.talla) || "").trim(),
    consumo: Number(r && r.consumo) || 0,
    colores: (Array.isArray(r && r.colores) ? r.colores : []).map(c => ({
      color: String((c && c.color) || "").trim(),
      cant: Math.max(0, Math.round(Number(c && c.cant) || 0))
    }))
  })).filter(r => r.talla || r.colores.some(c => c.cant > 0));
}

function derivarMatriz(m){
  const curva = m.map(r => ({ talla: r.talla, consumo: r.consumo, cant: r.colores.reduce((s, c) => s + c.cant, 0) }));
  const porColor = new Map();
  m.forEach(r => r.colores.forEach(c => {
    const k = c.color.toLowerCase();
    const prev = porColor.get(k);
    if(prev) prev.cant += c.cant; else porColor.set(k, { color: c.color, cant: c.cant });
  }));
  return { curva, colores: [...porColor.values()].filter(c => c.cant > 0 || c.color) };
}

module.exports = { normalizarMatriz, derivarMatriz };
