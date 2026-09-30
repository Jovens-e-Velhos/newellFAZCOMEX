/* =====================================================================
   Tratamento de Tributos DUIMP — lógica (roda 100% no navegador)
   Regra: separa por "|" a coluna de nomes e as colunas de valores e casa
   os dois pela POSIÇÃO. Cria uma coluna por tributo. Ausente => 0.
   ===================================================================== */
(function (root) {
  'use strict';

  const DEFAULTS = {
    colTipoPag: 'Pagamento - Tributo (Tipo)',
    colValorPag: 'Pagamento - Valor',
    colCodItem: 'Item Tributos - Tributo Código',
    prefixoItem: 'Item Tributos - ',
    tiposPag: ['TAXA_UTILIZACAO', 'COFINS', 'PIS', 'IPI', 'II'],
    tiposItem: ['II', 'IPI', 'PIS', 'COFINS'],
    metricas: ['Valor Calculado', 'Valor a Reduzir', 'Valor Suspenso',
               'Valor Devido', 'Valor a Recolher', 'Valor Alíquota'],
    duplicados: 'first' // 'first' = 1ª ocorrência (igual ao modelo) | 'sum' = soma
  };

  const isBlank = v => v === null || v === undefined || String(v).trim() === '';

  function split(s) {
    if (isBlank(s)) return [];
    return String(s).split('|').map(p => p.trim());
  }

  // "107254,18" -> 107254.18 | "1.234,56" -> 1234.56 | 12.5 -> 12.5 | vazio -> 0
  function num(v) {
    if (typeof v === 'number') return v;
    if (isBlank(v)) return 0;
    let s = String(v).trim();
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // valor na mesma posição do tributo (1ª ocorrência ou soma das ocorrências)
  function pick(nomes, valores, tipo, modo) {
    let total = 0, achou = false;
    for (let k = 0; k < nomes.length; k++) {
      if (nomes[k] !== tipo) continue;
      if (k < valores.length) { total += num(valores[k]); }
      achou = true;
      if (modo !== 'sum') break;
    }
    return achou ? total : 0;
  }

  const round = x => Math.round(x * 1e6) / 1e6;

  /** aoa = matriz [cabeçalho, ...linhas]. Retorna {aoa, stats}. */
  function treat(aoa, userCfg) {
    const cfg = Object.assign({}, DEFAULTS, userCfg || {});
    const rawHeader = aoa[0].map(h => (h === null || h === undefined ? '' : String(h).trim()));
    const idx = n => rawHeader.indexOf(n);
    const iTP = idx(cfg.colTipoPag), iVP = idx(cfg.colValorPag), iCI = idx(cfg.colCodItem);
    const faltando = [];
    if (iTP < 0) faltando.push(cfg.colTipoPag);
    if (iVP < 0) faltando.push(cfg.colValorPag);
    if (iCI < 0) faltando.push(cfg.colCodItem);
    if (faltando.length) throw new Error('Colunas obrigatórias não encontradas: ' + faltando.join(' · '));

    const metricas = cfg.metricas.filter(m => idx(cfg.prefixoItem + m) >= 0);
    const metricasAusentes = cfg.metricas.filter(m => idx(cfg.prefixoItem + m) < 0);

    const newPag = cfg.tiposPag.map(t => t + ' Pagamento');
    const newItem = [];
    metricas.forEach(m => cfg.tiposItem.forEach(t => newItem.push(t + ' - ' + m)));
    const novos = new Set([...newPag, ...newItem]);

    // se o arquivo já tem colunas derivadas (reprocessamento), elas são refeitas
    const keep = [];
    rawHeader.forEach((h, i) => { if (!novos.has(h)) keep.push(i); });

    // cabeçalho final: derivadas de Pagamento logo após "Pagamento - Valor"; as de Item no fim
    const outHeader = [];
    keep.forEach(i => {
      outHeader.push(rawHeader[i]);
      if (i === iVP) newPag.forEach(h => outHeader.push(h));
    });
    newItem.forEach(h => outHeader.push(h));

    const stats = {
      linhas: 0, somaBruta: 0, somaDerivada: 0, invalidos: 0,
      foraPag: {}, foraItem: {}, linhasRepetidas: 0, linhasDescasadas: 0,
      metricasAusentes, colunasNovas: newPag.length + newItem.length
    };
    const count = (o, k) => { o[k] = (o[k] || 0) + 1; };

    const out = [outHeader];
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row || row.every(isBlank)) continue;
      stats.linhas++;

      // ---- Pagamento
      const tp = split(row[iTP]), vp = split(row[iVP]);
      if (tp.length !== vp.length) stats.linhasDescasadas++;
      if (new Set(tp).size !== tp.length) stats.linhasRepetidas++;
      tp.forEach(t => { if (!cfg.tiposPag.includes(t)) count(stats.foraPag, t); });
      vp.forEach(v => { const n = num(v); if (Number.isNaN(n)) stats.invalidos++; else stats.somaBruta += n; });
      const pagVals = cfg.tiposPag.map(t => {
        const v = pick(tp, vp, t, cfg.duplicados);
        if (Number.isNaN(v)) { stats.invalidos++; return 0; }
        stats.somaDerivada += v;
        return v;
      });

      // ---- Item Tributos
      const ci = split(row[iCI]);
      ci.forEach(t => { if (!cfg.tiposItem.includes(t)) count(stats.foraItem, t); });
      const itemVals = [];
      metricas.forEach(m => {
        const vs = split(row[idx(cfg.prefixoItem + m)]);
        cfg.tiposItem.forEach(t => {
          let v = pick(ci, vs, t, cfg.duplicados);
          if (Number.isNaN(v)) { stats.invalidos++; v = 0; }
          if (/Alíquota/i.test(m)) v = round(v / 100);
          itemVals.push(v);
        });
      });

      const o = [];
      keep.forEach(i => {
        o.push(row[i] === undefined ? null : row[i]);
        if (i === iVP) pagVals.forEach(v => o.push(v));
      });
      itemVals.forEach(v => o.push(v));
      out.push(o);
    }
    stats.somaBruta = Math.round(stats.somaBruta * 100) / 100;
    stats.somaDerivada = Math.round(stats.somaDerivada * 100) / 100;
    return { aoa: out, stats };
  }

  /** Empilha várias matrizes tratadas pela união dos nomes de coluna. */
  function stack(list) {
    const header = [];
    list.forEach(a => a[0].forEach(h => { if (!header.includes(h)) header.push(h); }));
    const out = [header];
    list.forEach(a => {
      const map = a[0].map(h => header.indexOf(h));
      for (let r = 1; r < a.length; r++) {
        const row = new Array(header.length).fill(null);
        map.forEach((dst, src) => { row[dst] = a[r][src]; });
        out.push(row);
      }
    });
    return out;
  }

  const api = { DEFAULTS, split, num, pick, treat, stack };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DuimpCore = api;

  /* =====================================================================
     INTERFACE
     ===================================================================== */
  if (typeof document === 'undefined') return;

  const $ = s => document.querySelector(s);
  const fmtBR = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = n => n.toLocaleString('pt-BR');
  let arquivos = []; // {name, aoa}
  let resultados = []; // {name, aoa, stats}

  const el = {
    drop: $('#drop'), input: $('#file'), lista: $('#lista'), painel: $('#painel'),
    tPag: $('#tiposPag'), tItem: $('#tiposItem'), dup: $('#duplicados'),
    metricas: $('#metricas'), empilhar: $('#empilhar'), run: $('#run'),
    saida: $('#saida'), erro: $('#erro'), reset: $('#reset')
  };

  const parseList = s => s.split(',').map(x => x.trim()).filter(Boolean);
  el.tPag.value = DEFAULTS.tiposPag.join(', ');
  el.tItem.value = DEFAULTS.tiposItem.join(', ');

  function showError(msg) { el.erro.textContent = msg || ''; el.erro.hidden = !msg; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  async function lerArquivo(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    // escolhe a aba que contém a coluna de tributos; senão, a primeira
    let nome = wb.SheetNames.find(n => {
      const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, range: 0, defval: null })[0] || [];
      return r.includes(DEFAULTS.colTipoPag);
    }) || wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: null, raw: true });
    return { name: file.name, aba: nome, aoa };
  }

  function atualizarMetricas() {
    // lista as colunas "Item Tributos - ..." do primeiro arquivo como opções
    const h = (arquivos[0] && arquivos[0].aoa[0] || []).map(x => String(x || '').trim());
    const cols = h.filter(x => x.startsWith(DEFAULTS.prefixoItem) && x !== DEFAULTS.colCodItem)
                  .map(x => x.slice(DEFAULTS.prefixoItem.length));
    el.metricas.innerHTML = cols.map(c =>
      `<label class="chk"><input type="checkbox" value="${esc(c)}" ${DEFAULTS.metricas.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`
    ).join('') || '<span class="muted">Nenhuma coluna “Item Tributos - …” encontrada.</span>';
  }

  async function aoSelecionar(files) {
    showError('');
    try {
      for (const f of files) {
        if (!/\.(xlsx|xlsm|xls|csv)$/i.test(f.name)) continue;
        arquivos.push(await lerArquivo(f));
      }
    } catch (e) { showError('Não foi possível ler o arquivo: ' + e.message); }
    desenharLista();
  }

  function desenharLista() {
    el.lista.innerHTML = arquivos.map((a, i) =>
      `<li><span class="nome">${esc(a.name)}</span><span class="muted">aba “${esc(a.aba)}” · ${fmtInt(Math.max(a.aoa.length - 1, 0))} linhas</span>
       <button class="x" data-i="${i}" title="Remover">×</button></li>`).join('');
    el.painel.hidden = arquivos.length === 0;
    if (arquivos.length) atualizarMetricas();
    el.saida.innerHTML = ''; resultados = [];
  }

  el.lista.addEventListener('click', e => {
    const b = e.target.closest('button.x'); if (!b) return;
    arquivos.splice(+b.dataset.i, 1); desenharLista();
  });
  el.input.addEventListener('change', e => { aoSelecionar([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.remove('over'); }));
  el.drop.addEventListener('drop', e => aoSelecionar([...e.dataTransfer.files]));
  el.reset.addEventListener('click', () => { arquivos = []; desenharLista(); showError(''); });

  function baixar(nome, aoa) {
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    // colunas "<TRIBUTO> - Valor Alíquota…" => formato de porcentagem (0,18 vira 18,00%)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const h = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (!h || !/^[A-Za-z0-9_]+ - .*Alíquota/i.test(String(h.v))) continue;
      for (let r = 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.t === 'n') cell.z = '0.00%';
      }
    }
    ws['!autofilter'] = { ref: ws['!ref'] };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analytic DUIMPs');
    XLSX.writeFile(wb, nome, { compression: true });
  }

  function statsHtml(nome, s) {
    const dif = Math.round((s.somaBruta - s.somaDerivada) * 100) / 100;
    const fora = o => Object.entries(o).map(([k, v]) => `${esc(k)} (${fmtInt(v)})`).join(', ');
    const av = [];
    if (Object.keys(s.foraPag).length) av.push(`Tributos de <b>Pagamento</b> sem coluna: ${fora(s.foraPag)}. Para gerar coluna, inclua o nome na lista de tributos.`);
    if (Object.keys(s.foraItem).length) av.push(`Tributos de <b>Item</b> sem coluna: ${fora(s.foraItem)}.`);
    if (s.linhasRepetidas) av.push(`${fmtInt(s.linhasRepetidas)} linha(s) com tributo repetido em Pagamento — regra aplicada: ${el.dup.value === 'sum' ? 'somar' : 'usar a 1ª ocorrência'}.`);
    if (s.linhasDescasadas) av.push(`${fmtInt(s.linhasDescasadas)} linha(s) com quantidade de nomes ≠ quantidade de valores em Pagamento.`);
    if (s.invalidos) av.push(`${fmtInt(s.invalidos)} valor(es) não numéricos foram tratados como 0.`);
    if (s.metricasAusentes.length) av.push(`Colunas não encontradas neste arquivo: ${s.metricasAusentes.map(esc).join(', ')}.`);
    const okSoma = dif === 0;
    return `<div class="card">
      <h3>${esc(nome)}</h3>
      <div class="kpis">
        <div><b>${fmtInt(s.linhas)}</b><span>linhas</span></div>
        <div><b>${fmtInt(s.colunasNovas)}</b><span>colunas criadas</span></div>
        <div class="${okSoma ? 'ok' : 'warn'}"><b>${okSoma ? '✔ fecha' : 'R$ ' + fmtBR(dif)}</b><span>${okSoma ? 'soma de Pagamento confere' : 'diferença (tributos sem coluna)'}</span></div>
      </div>
      <p class="muted">Soma bruta “Pagamento - Valor”: R$ ${fmtBR(s.somaBruta)} · Soma das colunas criadas: R$ ${fmtBR(s.somaDerivada)}</p>
      ${av.length ? '<ul class="avisos">' + av.map(a => `<li>${a}</li>`).join('') + '</ul>' : ''}
    </div>`;
  }

  el.run.addEventListener('click', () => {
    showError(''); el.saida.innerHTML = '<p class="muted">Processando…</p>';
    setTimeout(() => {
      try {
        const cfg = {
          tiposPag: parseList(el.tPag.value), tiposItem: parseList(el.tItem.value),
          duplicados: el.dup.value,
          metricas: [...el.metricas.querySelectorAll('input:checked')].map(i => i.value)
        };
        resultados = arquivos.map(a => Object.assign({ name: a.name }, treat(a.aoa, cfg)));
        let html = resultados.map(r => statsHtml(r.name, r.stats)).join('');
        html += '<div class="acoes">';
        if (el.empilhar.checked && resultados.length > 1) {
          html += '<button class="btn" id="dlAll">⬇ Baixar arquivo único (empilhado)</button>';
        } else {
          html += resultados.map((r, i) => `<button class="btn" data-dl="${i}">⬇ Baixar ${esc(r.name.replace(/\.[^.]+$/, ''))}_TRATADO.xlsx</button>`).join('');
        }
        html += '</div>';
        el.saida.innerHTML = html;
      } catch (e) { el.saida.innerHTML = ''; showError(e.message); }
    }, 30);
  });

  el.saida.addEventListener('click', e => {
    const one = e.target.closest('[data-dl]');
    if (one) { const r = resultados[+one.dataset.dl]; baixar(r.name.replace(/\.[^.]+$/, '') + '_TRATADO.xlsx', r.aoa); }
    if (e.target.id === 'dlAll') baixar('DUIMPs_EMPILHADO_TRATADO.xlsx', stack(resultados.map(r => r.aoa)));
  });
})(typeof window !== 'undefined' ? window : globalThis);
