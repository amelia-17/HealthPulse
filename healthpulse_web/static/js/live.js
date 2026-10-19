/* HealthPulse - Live Patient Event Stream panel (polls /api/stream/live/state) */
(function () {
    const $ = id => document.getElementById(id);
    const MAX_POINTS = 60;
    let timer = null, since = 0, chart = null;
    let labels = [], estimates = [], exacts = [];
    let sources = null;          // from /api/stream/live/sources

    const esc = s => { const d = document.createElement("div"); d.textContent = String(s ?? ""); return d.innerHTML; };

    async function api(path, method, body) {
        const response = await fetch(path, {
            method: method || "GET",
            headers: {"Content-Type": "application/json"},
            body: body ? JSON.stringify(body) : undefined
        });
        const ct = response.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
            throw new Error(`Server returned ${response.status} instead of JSON. Restart Flask with the latest app.py.`);
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Request failed");
        return data;
    }

    function showError(msg) {
        const box = $("liveError");
        if (!msg) { box.classList.add("d-none"); return; }
        box.textContent = msg;
        box.classList.remove("d-none");
    }

    function fillWatch() {
        const src = $("liveSource") ? $("liveSource").value : "simulated";
        const info = sources && sources[src];
        const sel = $("liveWatch");
        sel.innerHTML = "";
        (info ? info.watch_options : []).forEach(o => sel.add(new Option(o, o)));
        if (info) sel.value = info.default_watch;
        const note = $("liveSourceNote");
        if (note) {
            note.textContent = src === "mimic"
                ? (sources && sources.mimic ? `${sources.mimic.events} real admissions replayed in time order; DGIM watches the diagnosis group.` : (sources && sources.mimic_error) || "")
                : "Random hospital events across 12 localities, with occasional outbreaks.";
        }
        const label = $("liveFmLabel");
        if (label) label.textContent = src === "mimic" ? "distinct patients" : "distinct localities";
    }

    async function loadSources() {
        try { sources = await api("/api/stream/live/sources"); } catch (e) { sources = null; }
        fillWatch();
    }

    function setRunning(running) {
        if ($("liveSource")) $("liveSource").disabled = running;
        $("liveStart").disabled = running;
        $("liveStop").disabled = !running;
        const s = $("liveStatus");
        s.className = running ? "badge bg-success" : "badge bg-secondary";
        s.textContent = running ? "LIVE" : "Stopped";
    }

    function resetChart() {
        labels = []; estimates = []; exacts = [];
        if (chart) { chart.data.labels = labels; chart.data.datasets[0].data = estimates; chart.data.datasets[1].data = exacts; chart.update(); }
    }

    function ensureChart() {
        if (chart || !window.Chart) return;
        chart = new Chart($("liveChart"), {
            type: "line",
            data: {
                labels: labels,
                datasets: [
                    {label: "DGIM estimate", data: estimates, borderColor: "rgb(220,38,38)", backgroundColor: "rgba(220,38,38,0.1)", tension: 0.25, pointRadius: 0, fill: true},
                    {label: "Exact (validation)", data: exacts, borderColor: "rgb(100,116,139)", borderDash: [5, 4], tension: 0.25, pointRadius: 0}
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                scales: {y: {beginAtZero: true, suggestedMax: 10, title: {display: true, text: "Cases in last window"}},
                         x: {title: {display: true, text: "Event number"}}}
            }
        });
    }

    function render(s) {
        ensureChart();
        const w = s.watched;

        $("liveEvents").textContent = s.processed.toLocaleString();
        $("liveFlagged").textContent = s.flagged.toLocaleString();
        $("liveWindowLabel").textContent = `(last ${w.window_size})`;
        $("liveDgimEst").textContent = w.estimated_cases;
        $("liveDgimExact").textContent = w.exact_cases_in_window;
        const spike = w.status.includes("SPIKE");
        const badge = $("liveDgimStatus");
        badge.textContent = w.status;
        badge.className = spike ? "badge bg-danger" : "badge bg-success";
        if ($("liveFmLabel") && s.fm_label) $("liveFmLabel").textContent = s.fm_label;
        if ($("liveProgress")) $("liveProgress").textContent = s.total ? `(${s.processed} / ${s.total})` : "";
        $("liveFmEst").textContent = s.fm.estimated_distinct_localities;
        $("liveFmExact").textContent = s.fm.exact_distinct_localities;
        $("liveBits").textContent = w.binary_stream_tail.join(" ") || "-";
        $("liveBuckets").textContent = w.buckets.map(b => `[t${b.timestamp}: ${b.size}]`).join(" ") || "none";

        if (chart) {
            labels.push(w.clock); estimates.push(w.estimated_cases); exacts.push(w.exact_cases_in_window);
            while (labels.length > MAX_POINTS) { labels.shift(); estimates.shift(); exacts.shift(); }
            chart.update();
        }

        if (s.events.length) {
            const rows = [...s.events].reverse().slice(0, 14).map(e => `
                <tr class="${e.disease === w.disease ? 'table-warning' : ''}">
                    <td>${esc(e.time)}</td><td>${esc(e.disease)}</td><td>${esc(e.locality)}</td>
                    <td>${e.bloom_flag ? '<span class="badge bg-warning text-dark">NOTIFIABLE</span>' : '-'}</td>
                </tr>`).join("");
            $("liveFeed").innerHTML = rows;
            since = s.seq;
        }
        // Feed the Case Monitoring chart, Case Event Monitor and Distinct panel (dashboard.js).
        if (window.healthPulseLive) window.healthPulseLive.update(s);
        setRunning(s.running);
    }

    async function poll() {
        try {
            const s = await api(`/api/stream/live/state?since=${since}&watch=${encodeURIComponent($("liveWatch").value)}`);
            showError("");
            render(s);
            if (!s.running) stopPolling();
        } catch (e) {
            showError(e.message);
            stopPolling();
        }
    }

    function startPolling() { if (!timer) timer = setInterval(poll, 1000); }
    function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

    async function start() {
        showError("");
        try {
            await api("/api/stream/live/start", "POST", {
                rate: Number($("liveRate").value), watch: $("liveWatch").value,
                source: $("liveSource") ? $("liveSource").value : "simulated",
                loop: $("liveLoop") ? $("liveLoop").checked : false
            });
            since = 0;
            resetChart();
            if (window.healthPulseLive) window.healthPulseLive.reset();
            setRunning(true);
            startPolling();
            poll();
        } catch (e) { showError(e.message); }
    }

    async function stop() {
        try { await api("/api/stream/live/stop", "POST"); } catch (e) { showError(e.message); }
        setRunning(false);
        stopPolling();
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (!$("liveCard")) return;
        $("liveStart").addEventListener("click", start);
        $("liveStop").addEventListener("click", stop);
        $("liveWatch").addEventListener("change", () => { resetChart(); if (timer) poll(); });
        if ($("liveSource")) $("liveSource").addEventListener("change", fillWatch);
        loadSources();
        // If the stream is already running (page reloaded), reattach to it.
        api("/api/stream/live/state?since=0").then(s => { if (s.running) { render(s); startPolling(); } }).catch(() => {});
    });
})();