(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const empty = () => ({ lines: [], note: '', pending: null, receipt: null, receipts: [] });
  const clean = value => String(value ?? '').slice(0, 500);
  const normalized = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const product = item => ({ codigo: clean(item.codigo), descripcion: clean(item.descripcion), categoria: clean(item.categoria), unidad: clean(item.unidad) || 'PZA' });
  const validQuantity = value => /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) <= 1000000;
  const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  function searchProducts(products, query) {
    const words = normalized(query).trim().split(/\s+/).filter(Boolean);
    return products.map(product).filter(item => words.every(word => normalized(`${item.codigo} ${item.descripcion} ${item.categoria}`).includes(word)));
  }
  function isDemoAllowed(hostname, search) {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname) && new URLSearchParams(search).get('demo') === '1';
  }
  function tokenFromHash(hash) {
    return new URLSearchParams(hash.replace(/^#/, '')).get('token') || '';
  }
  async function storageKey(token, cryptoImpl) {
    const bytes = new TextEncoder().encode(token);
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return 'sumetec-pedidos:v1:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function validateLines(lines) {
    if (!Array.isArray(lines) || lines.length > 100 || lines.some(line => !line || typeof line.codigo !== 'string' || !line.codigo || !validQuantity(line.cantidad)) || new Set(lines.map(line => line.codigo)).size !== lines.length) {
      throw new Error('Revisa las cantidades: de 1 a 1,000,000 por producto y hasta 100 productos distintos.');
    }
  }
  function receiptValue(receipt) {
    if (!receipt || !validId(receipt.id) || typeof receipt.folio !== 'string' || !receipt.folio) throw new Error('No pudimos comprobar el recibo del pedido.');
    return {id: receipt.id, folio: clean(receipt.folio), estado: clean(receipt.estado || 'PENDIENTE'), fecha: clean(receipt.fecha), referencia: clean(receipt.referencia)};
  }
  function createCart({ storage, key, uuid, locks = root.navigator?.locks }) {
    let current = empty(), savedVersion = null;
    function read() { try {
      const saved = storage.getItem(key);
      const next = saved === null ? empty() : JSON.parse(saved);
      if (saved !== null) {
        validateLines(next.lines);
        if (typeof next.note !== 'string' || next.note.length > 1000 || !Object.hasOwn(next, 'pending') || !Object.hasOwn(next, 'receipt')) throw new Error();
        if (next.pending) {
          validateLines(next.pending.lineas);
          if (!validId(next.pending.id) || !next.pending.lineas.length || typeof next.pending.nota !== 'string' || next.pending.nota.length > 1000) throw new Error();
        }
        if (next.receipt) next.receipt = receiptValue(next.receipt);
        if (next.receipts === undefined) next.receipts = next.receipt ? [clone(next.receipt)] : [];
        if (!Array.isArray(next.receipts)) throw new Error();
        next.receipts = next.receipts.map(receiptValue);
        if (new Set(next.receipts.map(r => r.id)).size !== next.receipts.length) throw new Error();
      }
      current = next; savedVersion = saved;
    } catch (_) { throw new Error('No se pudo abrir tu pedido guardado. No borres los datos del navegador: contacta a SUMETEC para revisar si ya llegó.'); } }
    read();
    function save(next) {
      let latest;
      try { latest = storage.getItem(key); }
      catch (_) { throw new Error('No podemos leer el pedido guardado. Permite el almacenamiento y vuelve a intentar.'); }
      if (latest !== savedVersion) throw new Error('Tu pedido cambió en otra pestaña. Actualiza esta página para continuar con el pedido guardado.');
      try {
        const serialized = JSON.stringify(next);
        storage.setItem(key, serialized);
        if (storage.getItem(key) !== serialized) throw new Error();
        savedVersion = serialized;
      } catch (_) { throw new Error('No podemos guardar tu pedido en este dispositivo. Libera espacio o permite el almacenamiento y vuelve a intentar. No cierres esta página.'); }
      current = next;
    }
    function editable() {
      if (current.pending || current.receipt) throw new Error('Este pedido ya se envió o espera confirmación. Revisa su estado antes de iniciar otro.');
    }
    return {
      get state() { return clone(current); },
      async exclusive(action, {refresh = false} = {}) {
        if (typeof locks?.request !== 'function') throw new Error('Este navegador no permite el acceso exclusivo al pedido. Abre tu enlace en un navegador actualizado antes de enviarlo.');
        return locks.request(key, async () => {
          if (storage.getItem(key) !== savedVersion) {
            read();
            if (!refresh) throw new Error('Tu pedido cambió en otra pestaña. Revisa las cantidades guardadas antes de continuar.');
          }
          return action();
        });
      },
      flush() { save(clone(current)); },
      add(item, quantity = 1) {
        editable();
        if (!validQuantity(quantity) || !item.codigo) throw new Error('Escribe una cantidad entera entre 1 y 1,000,000.');
        const next = clone(current); const existing = next.lines.find(line => line.codigo === String(item.codigo));
        if (existing) existing.cantidad += Number(quantity);
        else next.lines.push({ ...product(item), cantidad: Number(quantity) });
        validateLines(next.lines); save(next);
      },
      setQuantity(code, quantity) {
        editable(); const next = clone(current);
        if (!validQuantity(quantity)) throw new Error('Escribe una cantidad entera entre 1 y 1,000,000.');
        const line = next.lines.find(item => item.codigo === code);
        if (line) line.cantidad = Number(quantity);
        save(next);
      },
      remove(code) { editable(); const next = clone(current); next.lines = next.lines.filter(item => item.codigo !== code); save(next); },
      setNote(note) {
        editable(); if (typeof note !== 'string' || note.length > 1000) throw new Error('La nota puede tener hasta 1,000 caracteres.');
        save({ ...clone(current), note });
      },
      repeat(lines) {
        editable();
        if (current.lines.length || current.note) throw new Error('Tu carrito ya tiene información. Consérvala o quita sus productos y nota antes de repetir la última compra.');
        validateLines(lines);
        if (!lines.length) throw new Error('Todavía no hay una compra anterior que repetir.');
        save({...clone(current), lines: lines.map(line => ({...product(line), cantidad: Number(line.cantidad)}))});
      },
      prepare() {
        if (current.pending) return clone(current.pending);
        editable(); validateLines(current.lines);
        if (!current.lines.length) throw new Error('Agrega al menos un producto antes de enviar.');
        const id = uuid(); if (!validId(id)) throw new Error('Tu navegador no pudo preparar el pedido. Abre el enlace en un navegador actualizado.');
        const payload = { id, lineas: current.lines.map(({ codigo, cantidad }) => ({ codigo, cantidad })), nota: current.note };
        save({ ...clone(current), pending: payload });
        return clone(payload);
      },
      receive(receipt) {
        if (!current.pending || receipt?.id !== current.pending.id || typeof receipt.folio !== 'string' || !receipt.folio || typeof receipt.estado !== 'string') throw new Error('No pudimos comprobar la confirmación. Consulta el estado del mismo pedido.');
        const value = receiptValue(receipt);
        save({ ...clone(current), pending: null, receipt: value, receipts: [...current.receipts.filter(r => r.id !== value.id), value] });
      },
      updateReceipt(receipt) {
        const known = current.receipts.find(r => r.id === receipt?.id);
        if (!known || known.folio !== receipt.folio || typeof receipt.estado !== 'string') throw new Error('No pudimos comprobar el estado de esa solicitud.');
        const value = receiptValue(receipt);
        save({...clone(current), receipt: current.receipt?.id === value.id ? value : current.receipt, receipts: current.receipts.map(r => r.id === value.id ? value : r)});
      },
      rejectPending(id, proof) {
        if (proof?.descartado !== true || proof.id !== id || !current.pending || current.pending.id !== id) throw new Error('Primero comprueba si SUMETEC recibió el pedido pendiente.');
        save({ ...clone(current), pending: null });
      },
      startNew() {
        if (current.pending) throw new Error('Primero comprueba si SUMETEC recibió el pedido pendiente.');
        save({...empty(), receipts: clone(current.receipts)});
      }
    };
  }
  function createApi({ apiUrl, token, fetchImpl = root.fetch.bind(root), timeoutMs = 20000, pageHostname = root.location?.hostname }) {
    const endpoint = new URL(apiUrl);
    const loopback = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
    const localPreview = endpoint.protocol === 'http:' && loopback(endpoint.hostname) && loopback(pageHostname);
    if ((endpoint.protocol !== 'https:' && !localPreview) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('El enlace de servicio necesita configuración. Contacta a SUMETEC.');
    return async (tipo, data = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const payload = { tipo, token };
        if (tipo === 'enviar_pedido') Object.assign(payload, { id: data.id, lineas: data.lineas, nota: data.nota });
        else if (['estado_pedido', 'descartar_pedido'].includes(tipo)) payload.id = data.id;
        else if (!['catalogo_pedidos', 'historial_cliente'].includes(tipo)) throw new Error();
        const response = await fetchImpl(endpoint.href, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload), signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!result || typeof result !== 'object' || result.ok !== true) {
          const invalid = result && /TOKEN|ENLACE|NO_AUTORIZADO/.test(String(result.codigo));
          const unavailable = result?.codigo === 'PRODUCTO_NO_DISPONIBLE';
          const message = unavailable ? 'Un producto ya no está en el catálogo. Pulsa Corregir pedido: primero comprobaremos si llegó, para evitar duplicados.' : invalid ? 'Este enlace ya no está disponible. Pide a SUMETEC un enlace nuevo.' : 'No pudimos completar la consulta. Vuelve a intentar o contacta a SUMETEC.';
          throw Object.assign(new Error(message), { safe: true });
        }
        return result;
      } catch (error) {
        if (error.safe) throw error;
        throw new Error('No recibimos respuesta. Revisa tu conexión y vuelve a intentar. Si estabas enviando, consulta el estado o reintenta el mismo pedido.');
      } finally { clearTimeout(timer); }
    };
  }
  const exported = { validQuantity, searchProducts, isDemoAllowed, tokenFromHash, storageKey, createCart, createApi };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (!root.document) return;

  const $ = id => document.getElementById(id);
  // Aún sin enlace/configuración no hay captura abierta que guardar; se debe poder corregir la app por actualización.
  root.sumetecPedidosPuedeActualizar = () => Boolean($('workspace')?.hidden);
  root.sumetecPedidosGuardarParaActualizar = () => {
    if (!$('workspace')?.hidden) throw new Error('Espera a que termine de abrir tu pedido antes de actualizar.');
    return true;
  };
  const notice = (message, error = false) => { $('notice').textContent = message; $('notice').classList.toggle('error', error); };
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, handler, className = 'button secondary') {
    const node = element('button', className, label); node.type = 'button'; node.addEventListener('click', handler); return node;
  }
  const demoProducts = [
    { codigo: 'TL-0834', descripcion: 'Tornillo para lámina negro #8 × 3/4 pulg · cabeza Phillips', categoria: 'Tornillos para lámina', unidad: 'PZA' },
    { codigo: 'TH-3812', descripcion: 'Tornillo hexagonal 3/8 × 1 1/2 pulg · grado 5 · cuerda estándar', categoria: 'Tornillos hexagonales', unidad: 'PZA' },
    { codigo: 'TH-38', descripcion: 'Tuerca hexagonal 3/8 pulg · cuerda estándar · zincada', categoria: 'Tuercas', unidad: 'PZA' },
    { codigo: 'AP-38', descripcion: 'Arandela plana 3/8 pulg · acero zincado', categoria: 'Arandelas', unidad: 'PZA' },
    { codigo: 'AN-14', descripcion: 'Ancla expansiva 1/4 × 2 1/4 pulg · acero', categoria: 'Anclaje', unidad: 'PZA' },
    { codigo: 'BR-14', descripcion: 'Broca para metal 1/4 pulg · acero alta velocidad', categoria: 'Herramientas', unidad: 'PZA' }
  ];
  function demoApi(storage, key) {
    return async (tipo, data = {}) => {
      if (tipo === 'catalogo_pedidos') return { ok: true, cliente: 'Taller de muestra', productos: clone(demoProducts) };
      if (tipo === 'historial_cliente') return { ok: true, ultimo: demoProducts.slice(0, 3).map((item, i) => ({ ...item, cantidad: [100, 50, 50][i] })), frecuentes: clone(demoProducts.slice(0, 4)), fecha: '2026-10-16' };
      const receiptKey = key + ':demo-recibo';
      const saved = JSON.parse(storage.getItem(receiptKey) || 'null');
      const receipts = Array.isArray(saved) ? saved : saved ? [saved] : [];
      if (tipo === 'enviar_pedido') {
        const previous = receipts.find(r => r.id === data.id);
        const receipt = previous || { id: data.id, folio: 'DEMO-PED-' + String(receipts.length + 1).padStart(4, '0'), estado: 'PENDIENTE', fecha: new Date().toISOString() };
        if (!previous) receipts.push(receipt);
        storage.setItem(receiptKey, JSON.stringify(receipts));
        return { ok: true, pedido: receipt, notificacionPendiente: false };
      }
      const receipt = receipts.find(r => r.id === data.id);
      if (!receipt) throw new Error('Esta demostración no tiene una confirmación guardada. Reintenta el mismo pedido.');
      return { ok: true, pedido: receipt };
    };
  }

  async function boot() {
    const demo = isDemoAllowed(location.hostname, location.search);
    const token = demo ? 'demostracion-local-v1' : tokenFromHash(location.hash);
    const apiUrl = root.SUMETEC_PEDIDOS_CONFIG?.apiUrl;
    if (!demo && !token) {
      $('setup-title').textContent = 'Abre tu enlace personal';
      $('setup-message').textContent = 'Pide a SUMETEC tu enlace de pedidos y ábrelo completo desde la conversación donde lo recibiste. No necesitas cuenta ni contraseña.';
      return;
    }
    if (!demo && !apiUrl) {
      $('setup-title').textContent = 'El portal aún no está conectado';
      $('setup-message').textContent = 'SUMETEC necesita terminar la conexión del servicio. Conserva tu enlace y contacta a SUMETEC para hacer tu pedido mientras tanto.';
      return;
    }
    let model, api, cartKey;
    try {
      if (!root.crypto?.subtle || !root.crypto.randomUUID) throw new Error('Abre este enlace con una conexión segura y un navegador actualizado para guardar tu pedido.');
      cartKey = await storageKey(token, root.crypto);
      model = createCart({ storage: localStorage, key: cartKey, uuid: () => crypto.randomUUID() });
      api = demo ? demoApi(localStorage, cartKey) : createApi({ apiUrl, token });
    } catch (error) { $('setup-title').textContent = 'Necesitamos revisar tu dispositivo'; $('setup-message').textContent = error.message; return; }
    $('setup').hidden = true; $('workspace').hidden = false;
    $('demo-banner').hidden = !demo;
    let products = [], history = { ultimo: [], frecuentes: [] }, view = 'ultimo', busy = false, reviewedOrder = null, saving = 0;
    const openedHash = location.hash;
    window.addEventListener('hashchange', () => {
      const nextToken = tokenFromHash(location.hash);
      if (!demo && nextToken && nextToken !== token) {
        if (busy || saving) { window.history.replaceState(null, '', location.pathname + location.search + openedHash); notice('Espera a que termine el guardado, consulta o envío antes de abrir otro enlace.', true); }
        else location.reload();
      }
    });
    const locked = () => Boolean(model.state.pending || model.state.receipt || busy);
    root.sumetecPedidosPuedeActualizar = () => !busy && !saving;
    root.sumetecPedidosGuardarParaActualizar = async () => {
      if (busy || saving) throw new Error('Espera a que termine el guardado o envío antes de actualizar.');
      await model.exclusive(() => {
        if (!model.state.pending && !model.state.receipt) {
          for (const input of $('cart-lines').querySelectorAll('input[data-codigo]'))
            model.setQuantity(input.dataset.codigo, input.value);
          model.setNote($('note').value);
        }
        model.flush();
      });
      return true;
    };
    async function action(callback) {
      if (busy) return;
      saving++;
      try { await model.exclusive(callback); } catch (error) { notice(error.message, true); }
      finally { saving--; if (!saving) {renderCart(); renderProducts();} }
    }
    function renderProducts() {
      const query = $('search').value;
      const source = view === 'catalogo' ? products : (history[view] || []);
      const matches = searchProducts(source, query);
      $('products').replaceChildren();
      $('result-count').textContent = matches.length ? `${matches.length} producto${matches.length === 1 ? '' : 's'}${matches.length > 40 ? ' · mostrando 40; afina tu búsqueda' : ''}` : '';
      $('empty-products').hidden = matches.length > 0;
      $('empty-products').textContent = query ? 'No encontramos esa especificación. Prueba otra palabra o el código.' : view === 'catalogo' ? 'El catálogo todavía no tiene productos disponibles. Contacta a SUMETEC.' : 'Aquí aparecerán tus compras. Busca un producto en el catálogo para empezar.';
      for (const item of matches.slice(0, 40)) {
        const row = element('article', 'product');
        const details = element('div', 'product-details');
        details.append(element('p', 'product-code', item.codigo), element('h3', '', item.descripcion), element('p', 'product-unit', `${item.categoria ? item.categoria + ' · ' : ''}${item.unidad}`));
        const original = source.find(entry => entry.codigo === item.codigo);
        if (view === 'ultimo' && validQuantity(original?.cantidad)) details.append(element('p', 'previous-quantity', `La última vez: ${Number(original.cantidad)} ${item.unidad}`));
        const controls = element('div', 'product-action');
        const label = element('label', 'quantity-label', 'Cantidad');
        const quantity = element('input', 'quantity'); quantity.type = 'number'; quantity.inputMode = 'numeric'; quantity.min = '1'; quantity.max = '1000000'; quantity.step = '1'; quantity.value = '1'; quantity.setAttribute('aria-label', `Cantidad de ${item.codigo}`); quantity.disabled = locked();
        label.append(quantity);
        const add = button('Agregar', () => action(() => {
          model.add(item, quantity.value); notice(`${item.codigo} agregado a tu pedido.`); quantity.value = '1';
        }), 'button add'); add.disabled = locked();
        controls.append(label, add); row.append(details, controls); $('products').append(row);
      }
      document.querySelectorAll('[data-view]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.view === view)));
      $('section-title').textContent = view === 'ultimo' ? 'Tu última compra' : view === 'frecuentes' ? 'Lo que sueles llevar' : 'Busca tu siguiente producto';
    }
    function renderCart() {
      const state = model.state; const isLocked = locked();
      $('cart-lines').replaceChildren();
      $('cart-empty').hidden = state.lines.length > 0;
      $('cart-count').textContent = String(state.lines.length);
      $('cart-label').textContent = `${state.lines.length} producto${state.lines.length === 1 ? '' : 's'} en tu pedido`;
      for (const item of state.lines) {
        const row = element('li', 'cart-line');
        row.append(element('p', 'product-code', item.codigo), element('p', 'cart-description', item.descripcion || item.codigo));
        const controls = element('div', 'cart-controls');
        const label = element('label', 'cart-quantity', `Cantidad (${item.unidad || 'PZA'})`);
        const input = element('input', 'quantity'); input.type = 'number'; input.inputMode = 'numeric'; input.min = '1'; input.max = '1000000'; input.step = '1'; input.value = String(item.cantidad); input.disabled = isLocked;
        input.setAttribute('aria-label', `Cantidad en tu pedido de ${item.codigo}`);
        input.dataset.codigo = item.codigo;
        input.addEventListener('change', () => { const quantity = input.value; action(() => model.setQuantity(item.codigo, quantity)); });
        label.append(input);
        const remove = button('Quitar', () => action(() => model.remove(item.codigo)), 'text-button'); remove.disabled = isLocked;
        controls.append(label, remove); row.append(controls); $('cart-lines').append(row);
      }
      $('note').disabled = isLocked; $('note').value = state.note; $('note-count').textContent = `${state.note.length}/1000`;
      $('review').disabled = isLocked || !state.lines.length;
      $('pending').hidden = !state.pending;
      $('receipt').hidden = !state.receipt;
      $('retry-send').disabled = busy; $('check-status').disabled = busy; $('correct-order').disabled = busy; $('new-order').disabled = busy;
      $('repeat-last').disabled = isLocked || !!state.lines.length || !!state.note || !history.ultimo.length || !products.length;
      if (state.receipt) {
        $('receipt-folio').textContent = state.receipt.folio;
        $('receipt-status').textContent = state.receipt.estado.toUpperCase() === 'ATENDIDO' ? 'SUMETEC marcó tu solicitud como atendida.' : 'Solicitud recibida por SUMETEC.';
      }
      $('receipt-history').replaceChildren();
      $('history-empty').hidden = state.receipts.length > 0;
      for (const receipt of [...state.receipts].reverse()) {
        const row = element('li', 'saved-receipt');
        row.append(element('strong', '', receipt.folio), element('p', '', receipt.estado === 'ATENDIDO' ? 'Atendida' : 'Recibida por SUMETEC'));
        if (receipt.referencia) row.append(element('p', '', `Cotización: ${receipt.referencia}`));
        const check = button('Consultar estado', () => checkReceipt(receipt.id));
        check.disabled = busy; row.append(check); $('receipt-history').append(row);
      }
    }
    async function send(operation = 'enviar_pedido') {
      if (busy) return;
      const reviewed = operation === 'enviar_pedido' && !model.state.pending ? reviewedOrder : model.state;
      busy = true; renderCart(); renderProducts();
      $('review-dialog').close();
      notice(operation === 'estado_pedido' ? 'Consultando si SUMETEC recibió tu pedido…' : operation === 'descartar_pedido' ? 'Comprobando el pedido antes de permitir cambios…' : 'Enviando tu solicitud…');
      try {
        // El candado cubre lectura fresca, UUID durable, red y acuse; otra ventana reutiliza el mismo intento.
        await model.exclusive(async () => {
        const fresh = model.state;
        if (!reviewed || JSON.stringify([fresh.lines, fresh.note]) !== JSON.stringify([reviewed.lines, reviewed.note]) ||
            (reviewed.pending && reviewed.pending.id !== (fresh.pending?.id || fresh.receipt?.id))) throw new Error('Revisa el pedido otra vez: cambió en otra pestaña después de abrir la revisión.');
        if (model.state.receipt) { notice('Este pedido ya quedó registrado. Conservamos su folio sin enviarlo otra vez.'); return; }
        const payload = model.prepare();
        renderCart(); renderProducts();
        const result = await api(operation, operation === 'enviar_pedido' ? payload : { id: payload.id });
        if (result.descartado === true) {
          model.rejectPending(payload.id, result);
          notice('La solicitud anterior quedó descartada sin enviarse. Puedes corregir este pedido y volver a revisarlo.');
          return;
        }
        model.receive(result.pedido);
        notice(result.notificacionPendiente ? 'Tu solicitud quedó registrada. El aviso a SUMETEC está pendiente; no hace falta volver a enviarla.' : 'Tu solicitud quedó registrada. SUMETEC te confirma precio y existencia.');
        renderCart();
        $('receipt').focus();
        }, {refresh: true});
      } catch (error) { notice(error.message, true); }
      finally { busy = false; renderCart(); renderProducts(); }
    }
    async function checkReceipt(id) {
      if (busy) return;
      busy = true; renderCart(); renderProducts(); notice('Consultando el estado de tu solicitud…');
      try {
        await model.exclusive(async () => {
          const result = await api('estado_pedido', {id});
          model.updateReceipt(result.pedido);
        }, {refresh: true});
        notice('Estado de la solicitud actualizado.');
      } catch (error) { notice(error.message, true); }
      finally { busy = false; renderCart(); renderProducts(); }
    }
    $('note').addEventListener('input', async () => {
      const note = $('note').value;
      saving++;
      try { await model.exclusive(() => model.setNote(note)); $('note-count').textContent = `${note.length}/1000`; $('repeat-last').disabled = !!note || locked() || !!model.state.lines.length; }
      catch (error) { notice(error.message, true); renderCart(); renderProducts(); }
      finally { saving--; if (!saving) renderCart(); }
    });
    $('search').addEventListener('input', renderProducts);
    document.querySelectorAll('[data-view]').forEach(tab => tab.addEventListener('click', () => { view = tab.dataset.view; renderProducts(); }));
    $('jump-cart').addEventListener('click', () => { $('cart').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('cart-title').focus({ preventScroll: true }); });
    $('review').addEventListener('click', async () => {
      if (busy) return;
      const quantities = [...$('cart-lines').querySelectorAll('input[data-codigo]')].map(input => [input.dataset.codigo, input.value]);
      const note = $('note').value;
      saving++;
      try {
        await model.exclusive(() => {
          for (const [code, quantity] of quantities) model.setQuantity(code, quantity);
          model.setNote(note);
          const state = model.state; reviewedOrder = state; $('review-lines').replaceChildren();
          for (const item of state.lines) $('review-lines').append(element('li', '', `${item.cantidad} ${item.unidad || 'PZA'} · ${item.codigo} · ${item.descripcion || ''}`));
          $('review-note').textContent = state.note || 'Sin nota adicional.';
          $('review-dialog').showModal();
        });
      } catch (error) { notice(error.message, true); }
      finally { saving--; if (!saving) {renderCart(); renderProducts();} }
    });
    $('close-review').addEventListener('click', () => $('review-dialog').close());
    $('confirm-send').addEventListener('click', () => send());
    $('retry-send').addEventListener('click', () => send());
    $('check-status').addEventListener('click', () => send('estado_pedido'));
    $('correct-order').addEventListener('click', () => send('descartar_pedido'));
    $('new-order').addEventListener('click', () => action(() => { model.startNew(); renderProducts(); notice('Tu nuevo pedido está listo para agregar productos.'); $('search').focus(); }));
    $('repeat-last').addEventListener('click', () => action(() => {
      if (history.ultimo.some(line => !products.some(p => p.codigo === line.codigo))) throw new Error('Un producto de tu última compra ya no está en el catálogo. Revisa los productos disponibles antes de pedir.');
      model.repeat(history.ultimo); notice('Copiamos las cantidades de tu última compra. Revisa medidas y cantidades antes de enviar.');
      $('cart').scrollIntoView({behavior:'smooth', block:'start'}); $('cart-title').focus({preventScroll:true});
    }));
    window.addEventListener('beforeunload', event => { if (busy || saving) { event.preventDefault(); event.returnValue = ''; } });
    window.addEventListener('storage', event => {
      if (event.key !== null && event.key !== cartKey) return;
      if (!busy) model.exclusive(() => {renderCart(); renderProducts();}, {refresh:true}).catch(error => notice(error.message, true));
    });
    async function load() {
      $('reload-data').disabled = true; notice('Cargando tus productos…');
      const results = await Promise.allSettled([api('catalogo_pedidos'), api('historial_cliente')]);
      if (results[0].status === 'fulfilled' && Array.isArray(results[0].value.productos)) {
        products = results[0].value.productos.map(product);
        $('customer').textContent = clean(results[0].value.cliente) || 'Tu espacio de pedidos';
      }
      if (results[1].status === 'fulfilled') {
        const data = results[1].value;
        history = { ultimo: Array.isArray(data.ultimo) ? data.ultimo : [], frecuentes: Array.isArray(data.frecuentes) ? data.frecuentes : [] };
        if (data.fecha) {
          const date = new Date(data.fecha);
          if (!Number.isNaN(date.getTime())) $('history-date').textContent = `Última compra: ${date.toLocaleDateString('es-MX', { dateStyle: 'medium', timeZone: 'UTC' })}`;
        }
        if (!history.ultimo.length) view = 'catalogo';
      }
      const failure = results.find(result => result.status === 'rejected');
      notice(failure ? failure.reason.message : demo ? 'Demostración con productos inventados. Nada se envía a SUMETEC.' : 'Agrega productos y cantidades. SUMETEC te confirma precio y existencia.', Boolean(failure));
      $('reload-data').disabled = false; renderCart(); renderProducts();
    }
    $('reload-data').addEventListener('click', load);
    renderCart(); renderProducts(); await load();
  }
  boot().catch(() => {
    $('setup').hidden = false; $('workspace').hidden = true;
    $('setup-title').textContent = 'No pudimos abrir el portal';
    $('setup-message').textContent = 'Vuelve a abrir tu enlace. Si el problema continúa, contacta a SUMETEC antes de enviar de nuevo.';
  });
})(typeof window === 'undefined' ? globalThis : window);
