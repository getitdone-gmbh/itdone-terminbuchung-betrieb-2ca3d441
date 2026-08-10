(function () {
  'use strict';

  /* ---------------------------------------------------------
     Konfiguration: Öffnungszeiten und Termin-Länge
     Wochentag-Index folgt JS Date.getDay(): 0=So, 1=Mo, ... 6=Sa
  --------------------------------------------------------- */
  const OPEN_HOURS = {
    1: [9, 18], // Montag
    2: [9, 18],
    3: [9, 18],
    4: [9, 18],
    5: [9, 18],
    6: [9, 13], // Samstag
    // 0 = Sonntag: kein Eintrag = geschlossen
  };
  const SLOT_MINUTES = 30;
  const WHOLE_DAY = '__day__';

  const STORAGE_BOOKINGS = 'tb_bookings_v1';
  const STORAGE_BLOCKS = 'tb_blocks_v1';

  /* ---------------------------------------------------------
     Storage-Helfer (nur im Browser, siehe Hinweis in der UI)
  --------------------------------------------------------- */
  function loadList(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveList(key, list) {
    try {
      window.localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {
      /* ignore */
    }
  }
  function loadBookings() { return loadList(STORAGE_BOOKINGS); }
  function saveBookings(list) { saveList(STORAGE_BOOKINGS, list); }
  function loadBlocks() { return loadList(STORAGE_BLOCKS); }
  function saveBlocks(list) { saveList(STORAGE_BLOCKS, list); }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------------------------------------------------
     Datum-Helfer
  --------------------------------------------------------- */
  function pad(n) { return String(n).padStart(2, '0'); }

  function dateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayKey() { return dateKey(new Date()); }

  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDisplayDate(key) {
    return parseDateKey(key).toLocaleDateString('de-DE', {
      weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
    });
  }

  function isPastDate(key) {
    const d = parseDateKey(key);
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return d < t;
  }

  function isPastSlot(key, time) {
    if (isPastDate(key)) return true;
    if (key !== todayKey()) return false;
    const now = new Date();
    const [h, m] = time.split(':').map(Number);
    const slotDate = new Date();
    slotDate.setHours(h, m, 0, 0);
    return slotDate < now;
  }

  function getSlotsForDate(key) {
    const weekday = parseDateKey(key).getDay();
    const hours = OPEN_HOURS[weekday];
    if (!hours) return [];
    const [startH, endH] = hours;
    const slots = [];
    let cursorMinutes = startH * 60;
    const endMinutes = endH * 60;
    while (cursorMinutes < endMinutes) {
      const h = Math.floor(cursorMinutes / 60);
      const m = cursorMinutes % 60;
      slots.push(`${pad(h)}:${pad(m)}`);
      cursorMinutes += SLOT_MINUTES;
    }
    return slots;
  }

  /* ---------------------------------------------------------
     Ableitungen aus den Daten
  --------------------------------------------------------- */
  function getBookingsForDate(key, bookings) {
    return bookings.filter((b) => b.date === key);
  }

  function isWholeDayBlocked(key, blocks) {
    return blocks.some((b) => b.date === key && b.time === WHOLE_DAY);
  }

  function getBlockedTimesForDate(key, blocks) {
    return blocks.filter((b) => b.date === key && b.time !== WHOLE_DAY).map((b) => b.time);
  }

  function getDayStatus(key, bookings, blocks) {
    if (isPastDate(key)) return 'past';
    const weekday = parseDateKey(key).getDay();
    if (!OPEN_HOURS[weekday]) return 'closed';
    if (isWholeDayBlocked(key, blocks)) return 'closed';

    const allSlots = getSlotsForDate(key);
    const taken = new Set(getBookingsForDate(key, bookings).map((b) => b.time));
    const blockedTimes = new Set(getBlockedTimesForDate(key, blocks));
    const available = allSlots.filter((t) => !taken.has(t) && !blockedTimes.has(t) && !isPastSlot(key, t));

    return available.length > 0 ? 'has-slots' : 'full';
  }

  /* ---------------------------------------------------------
     State
  --------------------------------------------------------- */
  const state = {
    viewMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: null,
    pendingSlot: null, // { date, time }
  };

  /* ---------------------------------------------------------
     Toast
  --------------------------------------------------------- */
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('is-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('is-hidden'), 2600);
  }

  /* ---------------------------------------------------------
     View-Switch (Kunde / Inhaber)
  --------------------------------------------------------- */
  const switchButtons = document.querySelectorAll('.switch-btn');
  const viewBooking = document.getElementById('view-booking');
  const viewAdmin = document.getElementById('view-admin');

  switchButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchButtons.forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');

      const view = btn.dataset.view;
      if (view === 'booking') {
        viewBooking.classList.remove('is-hidden');
        viewAdmin.classList.add('is-hidden');
        renderCalendar();
        if (state.selectedDate) renderSlots(state.selectedDate);
      } else {
        viewAdmin.classList.remove('is-hidden');
        viewBooking.classList.add('is-hidden');
        renderAdmin();
      }
    });
  });

  /* ---------------------------------------------------------
     Kalender rendern
  --------------------------------------------------------- */
  const monthLabel = document.getElementById('monthLabel');
  const calendarGrid = document.getElementById('calendarGrid');

  document.getElementById('prevMonth').addEventListener('click', () => {
    state.viewMonth.setMonth(state.viewMonth.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    state.viewMonth.setMonth(state.viewMonth.getMonth() + 1);
    renderCalendar();
  });

  function renderCalendar() {
    const bookings = loadBookings();
    const blocks = loadBlocks();

    monthLabel.textContent = state.viewMonth.toLocaleDateString('de-DE', {
      month: 'long', year: 'numeric',
    });

    calendarGrid.innerHTML = '';

    const year = state.viewMonth.getFullYear();
    const month = state.viewMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    // Montag = 0 ... Sonntag = 6
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstWeekday; i++) {
      const filler = document.createElement('div');
      filler.className = 'day-cell empty';
      calendarGrid.appendChild(filler);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const key = dateKey(d);
      const status = getDayStatus(key, bookings, blocks);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `day-cell ${status}`;
      if (key === todayKey()) cell.classList.add('is-today');
      if (key === state.selectedDate) cell.classList.add('is-selected');

      const num = document.createElement('span');
      num.textContent = String(day);
      cell.appendChild(num);

      if (status === 'has-slots' || status === 'full') {
        const dot = document.createElement('span');
        dot.className = 'day-dot';
        cell.appendChild(dot);
      }

      if (status === 'past' || status === 'closed') {
        cell.disabled = true;
      } else {
        cell.addEventListener('click', () => {
          state.selectedDate = key;
          renderCalendar();
          renderSlots(key);
        });
      }

      calendarGrid.appendChild(cell);
    }
  }

  /* ---------------------------------------------------------
     Uhrzeiten-Liste rendern
  --------------------------------------------------------- */
  const slotsHeading = document.getElementById('slotsHeading');
  const slotsList = document.getElementById('slotsList');

  function renderSlots(key) {
    const bookings = loadBookings();
    const blocks = loadBlocks();

    slotsHeading.textContent = `Freie Zeiten am ${formatDisplayDate(key)}`;
    slotsList.innerHTML = '';

    if (isWholeDayBlocked(key, blocks) || !OPEN_HOURS[parseDateKey(key).getDay()]) {
      const p = document.createElement('p');
      p.className = 'empty-hint';
      p.textContent = 'An diesem Tag sind keine Termine verfügbar.';
      slotsList.appendChild(p);
      return;
    }

    const taken = new Map(getBookingsForDate(key, bookings).map((b) => [b.time, b]));
    const blockedTimes = new Set(getBlockedTimesForDate(key, blocks));
    const allSlots = getSlotsForDate(key);

    if (allSlots.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-hint';
      p.textContent = 'An diesem Tag sind keine Termine verfügbar.';
      slotsList.appendChild(p);
      return;
    }

    allSlots.forEach((time) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';

      const label = document.createElement('span');
      label.textContent = time + ' Uhr';
      btn.appendChild(label);

      const isTaken = taken.has(time);
      const isBlocked = blockedTimes.has(time);
      const isPast = isPastSlot(key, time);

      if (isPast) {
        btn.classList.add('is-taken');
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'Vorbei';
        btn.appendChild(tag);
        btn.disabled = true;
      } else if (isTaken) {
        btn.classList.add('is-taken');
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'Belegt';
        btn.appendChild(tag);
        btn.disabled = true;
      } else if (isBlocked) {
        btn.classList.add('is-taken');
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'Nicht verfügbar';
        btn.appendChild(tag);
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => openBookingModal(key, time));
      }

      slotsList.appendChild(btn);
    });
  }

  /* ---------------------------------------------------------
     Buchungs-Modal
  --------------------------------------------------------- */
  const bookingModal = document.getElementById('bookingModal');
  const modalSlotInfo = document.getElementById('modalSlotInfo');
  const bookingForm = document.getElementById('bookingForm');

  function openBookingModal(key, time) {
    state.pendingSlot = { date: key, time };
    modalSlotInfo.textContent = `${formatDisplayDate(key)} um ${time} Uhr`;
    bookingForm.reset();
    bookingModal.classList.remove('is-hidden');
    document.getElementById('custName').focus();
  }

  function closeBookingModal() {
    bookingModal.classList.add('is-hidden');
    state.pendingSlot = null;
  }

  document.getElementById('modalClose').addEventListener('click', closeBookingModal);
  document.getElementById('modalCancel').addEventListener('click', closeBookingModal);
  bookingModal.addEventListener('click', (e) => {
    if (e.target === bookingModal) closeBookingModal();
  });

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.pendingSlot) return;

    const name = document.getElementById('custName').value.trim();
    const phone = document.getElementById('custPhone').value.trim();
    const reason = document.getElementById('custReason').value.trim();
    if (!name || !phone || !reason) return;

    const bookings = loadBookings();

    // Sicherheitscheck: Zeitfenster in der Zwischenzeit schon vergeben?
    const conflict = bookings.some(
      (b) => b.date === state.pendingSlot.date && b.time === state.pendingSlot.time
    );
    if (conflict) {
      showToast('Dieser Termin wurde gerade eben vergeben. Bitte wählen Sie einen anderen.');
      closeBookingModal();
      renderSlots(state.pendingSlot.date);
      return;
    }

    bookings.push({
      id: makeId(),
      date: state.pendingSlot.date,
      time: state.pendingSlot.time,
      name,
      phone,
      reason,
      createdAt: new Date().toISOString(),
    });
    saveBookings(bookings);

    const bookedDate = state.pendingSlot.date;
    closeBookingModal();
    showToast('Ihr Termin wurde gebucht.');
    renderCalendar();
    renderSlots(bookedDate);
  });

  /* ---------------------------------------------------------
     Admin-Ansicht: Buchungen
  --------------------------------------------------------- */
  const bookingsBody = document.getElementById('bookingsBody');
  const noBookings = document.getElementById('noBookings');
  const statUpcoming = document.getElementById('statUpcoming');
  const statToday = document.getElementById('statToday');
  const statBlocked = document.getElementById('statBlocked');

  function renderAdmin() {
    renderBookingsTable();
    renderBlockedList();
    renderStats();
    populateBlockTimeOptions();
  }

  function renderBookingsTable() {
    const bookings = loadBookings().slice().sort((a, b) => {
      if (a.date === b.date) return a.time.localeCompare(b.time);
      return a.date.localeCompare(b.date);
    });

    bookingsBody.innerHTML = '';

    if (bookings.length === 0) {
      noBookings.classList.remove('is-hidden');
    } else {
      noBookings.classList.add('is-hidden');
    }

    bookings.forEach((b) => {
      const tr = document.createElement('tr');

      const tdDate = document.createElement('td');
      tdDate.textContent = formatDisplayDate(b.date);
      tr.appendChild(tdDate);

      const tdTime = document.createElement('td');
      tdTime.textContent = b.time + ' Uhr';
      tr.appendChild(tdTime);

      const tdName = document.createElement('td');
      tdName.textContent = b.name;
      tr.appendChild(tdName);

      const tdPhone = document.createElement('td');
      tdPhone.textContent = b.phone;
      tr.appendChild(tdPhone);

      const tdReason = document.createElement('td');
      tdReason.textContent = b.reason;
      tdReason.className = 'reason-cell';
      tr.appendChild(tdReason);

      const tdAction = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-delete';
      delBtn.textContent = 'Stornieren';
      delBtn.addEventListener('click', () => {
        if (!window.confirm(`Termin von ${b.name} am ${formatDisplayDate(b.date)} wirklich stornieren?`)) return;
        const remaining = loadBookings().filter((x) => x.id !== b.id);
        saveBookings(remaining);
        renderAdmin();
        showToast('Termin storniert.');
      });
      tdAction.appendChild(delBtn);
      tr.appendChild(tdAction);

      bookingsBody.appendChild(tr);
    });
  }

  function renderStats() {
    const bookings = loadBookings();
    const blocks = loadBlocks();
    const nowKey = todayKey();

    const upcoming = bookings.filter((b) => b.date >= nowKey).length;
    const today = bookings.filter((b) => b.date === nowKey).length;

    statUpcoming.textContent = String(upcoming);
    statToday.textContent = String(today);
    statBlocked.textContent = String(blocks.length);
  }

  /* ---------------------------------------------------------
     Admin-Ansicht: Zeiten blockieren
  --------------------------------------------------------- */
  const blockForm = document.getElementById('blockForm');
  const blockDateInput = document.getElementById('blockDate');
  const blockTimeSelect = document.getElementById('blockTime');
  const blockedList = document.getElementById('blockedList');
  const noBlocked = document.getElementById('noBlocked');

  blockDateInput.min = todayKey();
  blockDateInput.addEventListener('change', populateBlockTimeOptions);

  function populateBlockTimeOptions() {
    const key = blockDateInput.value;
    blockTimeSelect.innerHTML = '';

    const wholeDayOpt = document.createElement('option');
    wholeDayOpt.value = WHOLE_DAY;
    wholeDayOpt.textContent = 'Ganzer Tag';
    blockTimeSelect.appendChild(wholeDayOpt);

    if (!key) return;

    const slots = getSlotsForDate(key);
    slots.forEach((time) => {
      const opt = document.createElement('option');
      opt.value = time;
      opt.textContent = time + ' Uhr';
      blockTimeSelect.appendChild(opt);
    });
  }

  blockForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = blockDateInput.value;
    const time = blockTimeSelect.value;
    if (!key || !time) return;

    const blocks = loadBlocks();
    const already = blocks.some((b) => b.date === key && b.time === time);
    if (already) {
      showToast('Diese Zeit ist bereits blockiert.');
      return;
    }

    blocks.push({ id: makeId(), date: key, time });
    saveBlocks(blocks);
    blockForm.reset();
    blockDateInput.min = todayKey();
    populateBlockTimeOptions();
    renderAdmin();
    showToast('Zeit wurde blockiert.');
  });

  function renderBlockedList() {
    const blocks = loadBlocks().slice().sort((a, b) => {
      if (a.date === b.date) return a.time.localeCompare(b.time);
      return a.date.localeCompare(b.date);
    });

    blockedList.innerHTML = '';

    if (blocks.length === 0) {
      noBlocked.classList.remove('is-hidden');
    } else {
      noBlocked.classList.add('is-hidden');
    }

    blocks.forEach((b) => {
      const li = document.createElement('li');

      const label = document.createElement('span');
      const timeLabel = b.time === WHOLE_DAY ? 'Ganzer Tag' : b.time + ' Uhr';
      label.textContent = `${formatDisplayDate(b.date)} · ${timeLabel}`;
      li.appendChild(label);

      const freeBtn = document.createElement('button');
      freeBtn.type = 'button';
      freeBtn.className = 'btn-delete';
      freeBtn.textContent = 'Freigeben';
      freeBtn.addEventListener('click', () => {
        const remaining = loadBlocks().filter((x) => x.id !== b.id);
        saveBlocks(remaining);
        renderAdmin();
        showToast('Zeit wieder freigegeben.');
      });
      li.appendChild(freeBtn);

      blockedList.appendChild(li);
    });
  }

  /* ---------------------------------------------------------
     Start
  --------------------------------------------------------- */
  renderCalendar();
  populateBlockTimeOptions();
})();
