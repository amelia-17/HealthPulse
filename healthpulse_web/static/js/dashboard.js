/* =========================================================
   HEALTHPULSE ANALYTICS
   Interactive Dashboard JavaScript
   ========================================================= */


/* =========================================================
   GLOBAL DATA
   ========================================================= */

let diseaseData = [];

let diseaseCurrentPage = 1;
const diseaseRowsPerPage = 20;

let losData = [];

let bloomData = [];

let dgimData = [];

let fmData = [];

let capacityData = [];
let capacityChart = null;
let capacityFilters = {};

let capacityCurrentPage = 1;
const capacityRowsPerPage = 20;

let diseaseChart = null;

let losChart = null;

let dgimChart = null;
let liveMode = false;   // true while the Live Patient Event Stream feeds the monitoring panels


/* =========================================================
   DOM READY
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        initializeDashboard();

    }
);


/* =========================================================
   INITIALIZE
   ========================================================= */

async function initializeDashboard() {

    setupTabs();

    setupFilters();

    setupRefreshButton();

    setupKpiCards();

    /*
     * IMPORTANT:
     * This was missing from the latest version.
     * Without this, Analyze Event and Reset Stream
     * are never connected to the form/buttons.
     */
    setupStreamingImplementation();

    await loadDashboardData();

}


/* =========================================================
   LOAD ALL DATA
   ========================================================= */

async function loadDashboardData() {

    setRefreshState(true);

    try {

        const [
            summary,
            diseases,
            los,
            bloom,
            dgim,
            fm,
            capacity
        ] = await Promise.all([

            fetchJson(
                "/api/summary"
            ),

            fetchJson(
                "/api/disease-counts"
            ),

            fetchJson(
                "/api/los"
            ),

            fetchJson(
                "/api/bloom-alerts"
            ),

            fetchJson(
                "/api/dgim-results"
            ),

            fetchJson(
                "/api/fm-results"
            ),

            fetchJson(
                "/api/bed-capacity"
            ).catch(error => {

                console.warn(
                    "Capacity API unavailable:",
                    error
                );

                return {
                    data: [],
                    filters: {},
                    count: 0
                };

            })

        ]);


        diseaseData =
            Array.isArray(diseases)
                ? diseases
                : [];


        losData =
            Array.isArray(los)
                ? los
                : [];


        bloomData =
            Array.isArray(bloom)
                ? bloom
                : [];


        dgimData =
            Array.isArray(dgim)
                ? dgim
                : [];


        fmData =
            Array.isArray(fm)
                ? fm
                : [];


        capacityData =
            Array.isArray(
                capacity?.data
            )
                ? capacity.data
                : [];


        capacityFilters =
            capacity?.filters || {};


        diseaseCurrentPage = 1;

        capacityCurrentPage = 1;


        renderCapacityMetricFilter();

        renderCapacityChart();

        renderCapacityTable();


        liveMode = false;   // a full reload shows stored results until the live stream pushes again
        resetFmLabels();

        updateSummary(summary);

        renderDiseaseChart();

        renderLOSChart();

        renderDiseaseTable();

        renderLOSTable();

        renderBloomAlerts();

        renderDGIMChart();

        renderDGIMTable();

        renderFMResults();

        updateAlertSummary();

        updateTimestamp();


    }

    catch (error) {

        console.error(
            "Dashboard loading error:",
            error
        );

        showDashboardError(error);

    }

    finally {

        setRefreshState(false);

    }

}


/* =========================================================
   ROBUST JSON RESPONSE PARSER
   ========================================================= */

async function parseJsonResponse(
    response
) {

    const contentType =
        response.headers.get(
            "content-type"
        ) || "";


    const responseText =
        await response.text();


    /*
     * Flask normally returns:
     *
     * application/json
     *
     * If it returns HTML instead, such as a 404/500
     * debug page, do NOT call JSON.parse blindly.
     */

    if (
        !contentType
            .toLowerCase()
            .includes(
                "application/json"
            )
    ) {

        throw new Error(
            `Server returned ${response.status} ${response.statusText} instead of JSON. ` +
            `Check that Flask is running and that the API route exists.`
        );

    }


    try {

        return JSON.parse(
            responseText
        );

    }

    catch (error) {

        throw new Error(
            "Server returned invalid JSON."
        );

    }

}


/* =========================================================
   FETCH HELPER
   ========================================================= */

async function fetchJson(url) {

    const response =
        await fetch(url);


    const result =
        await parseJsonResponse(
            response
        );


    if (!response.ok) {

        throw new Error(
            result?.error ||
            `API request failed: ${response.status}`
        );

    }


    return result;

}


/* =========================================================
   SUMMARY
   ========================================================= */

function updateSummary(summary) {

    const diseaseRecords =
        document.getElementById(
            "diseaseRecords"
        );

    if (diseaseRecords) {

        diseaseRecords.textContent =
            summary?.disease_records ?? 0;

    }


    const bloomAlerts =
        document.getElementById(
            "bloomAlerts"
        );

    if (bloomAlerts) {

        bloomAlerts.textContent =
            summary?.bloom_alerts ?? 0;

    }


    const dgimRecords =
        document.getElementById(
            "dgimRecords"
        );

    if (dgimRecords) {

        dgimRecords.textContent =
            summary?.dgim_records ?? 0;

    }


    const fmLocalities =
        document.getElementById(
            "fmLocalities"
        );

    if (fmLocalities) {

        if (fmData.length > 0) {

            fmLocalities.textContent =
                fmData[0]
                    .fm_estimated_distinct_localities
                ?? 0;

        }

        else {

            fmLocalities.textContent = 0;

        }

    }

}


/* =========================================================
   DISEASE CHART
   ========================================================= */

function renderDiseaseChart() {

    const canvas =
        document.getElementById(
            "diseaseChart"
        );


    if (!canvas) {
        return;
    }


    let data =
        [...diseaseData];


    const sortDirection =
        document.getElementById(
            "diseaseSort"
        )?.value || "desc";


    data.sort(
        (a, b) => {

            const aCount =
                Number(a.count) || 0;

            const bCount =
                Number(b.count) || 0;


            return sortDirection === "desc"

                ? bCount - aCount

                : aCount - bCount;

        }
    );


    data =
        data.slice(
            0,
            15
        );


    const labels =
        data.map(
            item =>
                shortenDiseaseName(
                    item.disease
                )
        );


    const values =
        data.map(
            item =>
                Number(item.count) || 0
        );


    if (diseaseChart) {

        diseaseChart.destroy();

    }


    diseaseChart =
        new Chart(
            canvas,
            {

                type: "bar",

                data: {

                    labels: labels,

                    datasets: [{

                        label: "Cases",

                        data: values,

                        backgroundColor:
                            "rgba(37, 99, 235, 0.75)",

                        borderColor:
                            "rgb(37, 99, 235)",

                        borderWidth: 1,

                        borderRadius: 6

                    }]

                },

                options: {

                    responsive: true,

                    maintainAspectRatio: false,

                    interaction: {

                        mode: "index",

                        intersect: false

                    },

                    plugins: {

                        legend: {

                            display: false

                        },

                        tooltip: {

                            callbacks: {

                                label:
                                    function(context) {

                                        return (
                                            ` Cases: ${context.raw}`
                                        );

                                    }

                            }

                        }

                    },

                    scales: {

                        x: {

                            ticks: {

                                maxRotation: 45,

                                minRotation: 20

                            }

                        },

                        y: {

                            beginAtZero: true,

                            ticks: {

                                precision: 0

                            }

                        }

                    }

                }

            }
        );

}


/* =========================================================
   LOS CHART
   ========================================================= */

function renderLOSChart() {

    const canvas =
        document.getElementById(
            "losChart"
        );


    if (!canvas) {
        return;
    }


    const labels =
        losData.map(
            item =>
                item.admission_type
        );


    const values =
        losData.map(
            item =>
                Number(
                    item.average_los
                ) || 0
        );


    if (losChart) {

        losChart.destroy();

    }


    losChart =
        new Chart(
            canvas,
            {

                type: "bar",

                data: {

                    labels: labels,

                    datasets: [{

                        label:
                            "Average LOS",

                        data: values,

                        backgroundColor:
                            "rgba(14, 165, 233, 0.75)",

                        borderColor:
                            "rgb(14, 165, 233)",

                        borderWidth: 1,

                        borderRadius: 6

                    }]

                },

                options: {

                    indexAxis: "y",

                    responsive: true,

                    maintainAspectRatio: false,

                    plugins: {

                        legend: {

                            display: false

                        },

                        tooltip: {

                            callbacks: {

                                label:
                                    function(context) {

                                        return (
                                            ` ${Number(
                                                context.raw
                                            ).toFixed(2)} days`
                                        );

                                    }

                            }

                        }

                    },

                    scales: {

                        x: {

                            beginAtZero: true,

                            title: {

                                display: true,

                                text:
                                    "Average LOS (days)"

                            }

                        }

                    }

                }

            }
        );

}


/* =========================================================
   DISEASE TABLE
   ========================================================= */

function renderDiseaseTable() {

    const table =
        document.getElementById(
            "diseaseTable"
        );


    if (!table) {
        return;
    }


    const search =
        document.getElementById(
            "diseaseSearch"
        )?.value
        .toLowerCase()
        .trim() || "";


    let filtered =
        diseaseData.filter(
            item =>

                String(
                    item.disease || ""
                )
                    .toLowerCase()
                    .includes(search)

        );


    filtered.sort(
        (a, b) =>
            (
                Number(b.count) || 0
            ) -
            (
                Number(a.count) || 0
            )
    );


    const totalPages =
        Math.ceil(
            filtered.length /
            diseaseRowsPerPage
        );


    if (
        diseaseCurrentPage >
            totalPages
        &&
        totalPages > 0
    ) {

        diseaseCurrentPage =
            totalPages;

    }


    if (totalPages === 0) {

        diseaseCurrentPage = 1;

    }


    const totalCases =
        diseaseData.reduce(
            (
                sum,
                item
            ) =>

                sum +
                (
                    Number(
                        item.count
                    ) || 0
                ),

            0
        );


    const startIndex =
        (
            diseaseCurrentPage - 1
        ) *
        diseaseRowsPerPage;


    const endIndex =
        startIndex +
        diseaseRowsPerPage;


    const pageData =
        filtered.slice(
            startIndex,
            endIndex
        );


    table.innerHTML = "";


    if (
        filtered.length === 0
    ) {

        table.innerHTML = `

            <tr>

                <td
                    colspan="4"
                    class="empty-state">

                    No diseases found.

                </td>

            </tr>

        `;


        renderDiseasePagination(
            0,
            0
        );

        return;

    }


    pageData.forEach(
        (
            item,
            index
        ) => {

            const count =
                Number(
                    item.count
                ) || 0;


            const percentage =
                totalCases > 0

                    ? (
                        count /
                        totalCases
                    ) * 100

                    : 0;


            const recordNumber =
                startIndex +
                index +
                1;


            const row =
                document.createElement(
                    "tr"
                );


            row.innerHTML = `

                <td>
                    ${recordNumber}
                </td>

                <td>

                    <strong>
                        ${escapeHtml(
                            item.disease
                        )}
                    </strong>

                </td>

                <td>

                    <strong>
                        ${count}
                    </strong>

                </td>

                <td
                    style="min-width:180px">

                    <div
                        class="d-flex align-items-center gap-2">

                        <div
                            class="distribution-bar">

                            <div
                                class="distribution-fill"
                                style="width:${Math.min(
                                    percentage,
                                    100
                                )}%">

                            </div>

                        </div>

                        <small>
                            ${percentage.toFixed(1)}%
                        </small>

                    </div>

                </td>

            `;


            table.appendChild(
                row
            );

        }
    );


    renderDiseasePagination(
        filtered.length,
        totalPages
    );

}


/* =========================================================
   DISEASE PAGINATION
   ========================================================= */

function renderDiseasePagination(
    totalRecords,
    totalPages
) {

    const oldPagination =
        document.getElementById(
            "diseasePagination"
        );


    if (oldPagination) {

        oldPagination.remove();

    }


    const table =
        document.getElementById(
            "diseaseTable"
        );


    if (!table) {
        return;
    }


    const tableResponsive =
        table.closest(
            ".table-responsive"
        );


    if (!tableResponsive) {
        return;
    }


    const pagination =
        document.createElement(
            "div"
        );


    pagination.id =
        "diseasePagination";


    pagination.className =
        "d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 mb-2";


    const info =
        document.createElement(
            "div"
        );


    info.className =
        "text-muted small";


    if (totalRecords > 0) {

        const start =
            (
                diseaseCurrentPage - 1
            ) *
            diseaseRowsPerPage +
            1;


        const end =
            Math.min(
                diseaseCurrentPage *
                    diseaseRowsPerPage,
                totalRecords
            );


        info.textContent =
            `Showing ${start}-${end} of ${totalRecords} disease records`;

    }

    else {

        info.textContent =
            "No disease records";

    }


    const controls =
        document.createElement(
            "div"
        );


    controls.className =
        "d-flex align-items-center gap-1 flex-wrap";


    const previousButton =
        document.createElement(
            "button"
        );


    previousButton.type =
        "button";


    previousButton.className =
        "btn btn-sm btn-outline-primary";


    previousButton.innerHTML =
        `<i class="bi bi-chevron-left"></i> Previous`;


    previousButton.disabled =
        diseaseCurrentPage <= 1;


    previousButton.addEventListener(
        "click",
        () => {

            if (
                diseaseCurrentPage > 1
            ) {

                diseaseCurrentPage--;

                renderDiseaseTable();

            }

        }
    );


    controls.appendChild(
        previousButton
    );


    for (
        let page = 1;
        page <= totalPages;
        page++
    ) {

        const pageButton =
            document.createElement(
                "button"
            );


        pageButton.type =
            "button";


        pageButton.className =
            page ===
            diseaseCurrentPage

                ? "btn btn-sm btn-primary"

                : "btn btn-sm btn-outline-primary";


        pageButton.textContent =
            page;


        pageButton.addEventListener(
            "click",
            () => {

                diseaseCurrentPage =
                    page;

                renderDiseaseTable();

            }
        );


        controls.appendChild(
            pageButton
        );

    }


    const nextButton =
        document.createElement(
            "button"
        );


    nextButton.type =
        "button";


    nextButton.className =
        "btn btn-sm btn-outline-primary";


    nextButton.innerHTML =
        `Next <i class="bi bi-chevron-right"></i>`;


    nextButton.disabled =
        diseaseCurrentPage >=
        totalPages;


    nextButton.addEventListener(
        "click",
        () => {

            if (
                diseaseCurrentPage <
                totalPages
            ) {

                diseaseCurrentPage++;

                renderDiseaseTable();

            }

        }
    );


    controls.appendChild(
        nextButton
    );


    pagination.appendChild(
        info
    );


    pagination.appendChild(
        controls
    );


    tableResponsive.insertAdjacentElement(
        "afterend",
        pagination
    );

}


/* =========================================================
   LOS TABLE
   ========================================================= */

function renderLOSTable() {

    const table =
        document.getElementById(
            "losTable"
        );


    if (!table) {
        return;
    }


    table.innerHTML = "";


    if (
        losData.length === 0
    ) {

        table.innerHTML = `

            <tr>

                <td
                    colspan="3"
                    class="empty-state">

                    No LOS data available.

                </td>

            </tr>

        `;

        return;

    }


    const maxLOS =
        Math.max(
            ...losData.map(
                item =>
                    Number(
                        item.average_los
                    ) || 0
            )
        );


    losData.forEach(
        item => {

            const value =
                Number(
                    item.average_los
                ) || 0;


            const percentage =
                maxLOS > 0

                    ? (
                        value /
                        maxLOS
                    ) * 100

                    : 0;


            const row =
                document.createElement(
                    "tr"
                );


            row.innerHTML = `

                <td>

                    <strong>
                        ${escapeHtml(
                            item.admission_type
                        )}
                    </strong>

                </td>

                <td>

                    ${value.toFixed(2)}
                    days

                </td>

                <td
                    style="width:40%">

                    <div
                        class="distribution-bar">

                        <div
                            class="distribution-fill"
                            style="width:${percentage}%">

                        </div>

                    </div>

                </td>

            `;


            table.appendChild(
                row
            );

        }
    );

}


/* =========================================================
   BLOOM ALERTS
   ========================================================= */

function renderBloomAlerts() {

    const container =
        document.getElementById(
            "bloomAlertsList"
        );


    if (!container) {
        return;
    }


    const filter =
        document.getElementById(
            "bloomFilter"
        )?.value || "all";


    let filtered =
        bloomData.filter(
            item => {

                if (
                    filter === "all"
                ) {

                    return true;

                }

                return (
                    item.disease ===
                    filter
                );

            }
        );


    container.innerHTML = "";


    if (
        filtered.length === 0
    ) {

        container.innerHTML = `

            <div
                class="empty-state">

                No alerts found.

            </div>

        `;

        return;

    }


    filtered =
        [...filtered].reverse();


    filtered.forEach(
        item => {

            const alert =
                document.createElement(
                    "div"
                );


            alert.className =
                "health-alert";


            alert.innerHTML = `

                <div
                    class="health-alert-icon">

                    <i
                        class="bi bi-exclamation-triangle-fill">
                    </i>

                </div>

                <div
                    class="health-alert-content">

                    <div
                        class="health-alert-title">

                        ${escapeHtml(
                            item.disease
                        )}

                        <span
                            class="badge bg-warning text-dark ms-2">

                            POSSIBLY NOTIFIABLE

                        </span>

                    </div>

                    <div
                        class="health-alert-meta">

                        Patient:
                        ${escapeHtml(
                            item.patient_id
                        )}

                        &nbsp; • &nbsp;

                        Locality:
                        ${escapeHtml(
                            item.locality
                        )}

                        &nbsp; • &nbsp;

                        ${escapeHtml(
                            item.timestamp
                        )}

                    </div>

                </div>

            `;


            container.appendChild(
                alert
            );

        }
    );

}


/* =========================================================
   DGIM CHART
   ========================================================= */

function renderDGIMChart() {

    const canvas =
        document.getElementById(
            "dgimChart"
        );


    if (!canvas) {
        return;
    }


    const recent =
        dgimData.slice(
            -50
        );


    const labels =
        recent.map(
            item =>
                `#${item.event_number}`
        );


    const values =
        recent.map(
            item =>
                Number(
                    item.estimated_cases
                ) || 0
        );


    if (dgimChart) {

        dgimChart.destroy();

    }


    dgimChart =
        new Chart(
            canvas,
            {

                type: "line",

                data: {

                    labels: labels,

                    datasets: [{

                        label:
                            "Estimated Cases",

                        data: values,

                        borderColor:
                            "rgb(220, 38, 38)",

                        backgroundColor:
                            "rgba(220, 38, 38, 0.10)",

                        fill: true,

                        tension: 0.3,

                        pointRadius: 3,

                        pointHoverRadius: 6

                    }]

                },

                options: {

                    responsive: true,

                    maintainAspectRatio: false,

                    animation: liveMode ? false : undefined,

                    interaction: {

                        mode: "index",

                        intersect: false

                    },

                    plugins: {

                        legend: {

                            display: true

                        },

                        tooltip: {

                            callbacks: {

                                afterLabel:
                                    function(
                                        context
                                    ) {

                                        const index =
                                            context.dataIndex;


                                        const event =
                                            recent[
                                                index
                                            ];


                                        if (
                                            !event
                                        ) {

                                            return "";

                                        }


                                        return [

                                            `Disease: ${event.disease}`,

                                            `Status: ${event.status}`

                                        ];

                                    }

                            }

                        }

                    },

                    scales: {

                        y: {

                            beginAtZero: true,

                            title: {

                                display: true,

                                text:
                                    "Estimated Cases"

                            }

                        },

                        x: {

                            title: {

                                display: true,

                                text:
                                    "Admission Event"

                            }

                        }

                    }

                }

            }
        );


    updateDGIMStatus(
        recent
    );

}


/* =========================================================
   DGIM STATUS
   ========================================================= */

function updateDGIMStatus(
    data
) {

    const status =
        document.getElementById(
            "dgimStatus"
        );


    if (
        !status ||
        data.length === 0
    ) {

        return;

    }


    const latest =
        data[
            data.length - 1
        ];


    if (
        String(
            latest.status
        )
            .toUpperCase()
            .includes("SPIKE")
    ) {

        status.textContent =
            "CASE SPIKE DETECTED";


        status.className =
            "badge status-badge badge-spike";

    }

    else {

        status.textContent =
            "NORMAL";


        status.className =
            "badge status-badge badge-normal";

    }

}


/* =========================================================
   DGIM TABLE
   ========================================================= */

function renderDGIMTable() {

    const table =
        document.getElementById(
            "dgimTable"
        );


    const filter =
        document.getElementById(
            "dgimFilter"
        )?.value || "all";


    if (!table) {
        return;
    }


    let filtered =
        [...dgimData].sort(
            (a, b) =>
                Number(
                    a.event_number
                ) -
                Number(
                    b.event_number
                )
        );


    if (
        filter === "alerts"
    ) {

        filtered =
            filtered.filter(
                item =>
                    String(
                        item.status
                    )
                        .toUpperCase()
                        .includes(
                            "SPIKE"
                        )
            );


        filtered.reverse();


        filtered =
            filtered.slice(
                0,
                25
            );

    }


    if (
        filter === "normal"
    ) {

        filtered =
            filtered.filter(
                item =>
                    !String(
                        item.status
                    )
                        .toUpperCase()
                        .includes(
                            "SPIKE"
                        )
            );


        filtered.reverse();


        filtered =
            filtered.slice(
                0,
                25
            );

    }


    table.innerHTML = "";


    if (
        filtered.length === 0
    ) {

        table.innerHTML = `

            <tr>

                <td
                    colspan="5"
                    class="empty-state">

                    No events found.

                </td>

            </tr>

        `;

        return;

    }


    filtered.forEach(
        item => {

            const isSpike =
                String(
                    item.status
                )
                    .toUpperCase()
                    .includes(
                        "SPIKE"
                    );


            const row =
                document.createElement(
                    "tr"
                );


            row.innerHTML = `

                <td>

                    #${escapeHtml(
                        item.event_number
                    )}

                </td>

                <td>

                    ${escapeHtml(
                        item.admittime ||
                        item.timestamp ||
                        "—"
                    )}

                </td>

                <td>

                    ${escapeHtml(
                        item.disease
                    )}

                </td>

                <td>

                    <strong>

                        ${escapeHtml(
                            item.estimated_cases
                        )}

                    </strong>

                </td>

                <td>

                    <span
                        class="badge ${
                            isSpike

                                ? "badge-spike"

                                : "badge-normal"
                        }">

                        ${escapeHtml(
                            item.status
                        )}

                    </span>

                </td>

            `;


            table.appendChild(
                row
            );

        }
    );

}


/* =========================================================
   FLAJOLET-MARTIN
   ========================================================= */

function renderFMResults() {

    if (
        fmData.length === 0
    ) {

        return;

    }


    const fm =
        fmData[0];


    setText(
        "fmLocalities",
        fm.fm_estimated_distinct_localities
        ?? 0
    );


    setText(
        "fmPatients",
        fm.total_patient_records
        ??
        fm.stream_length
        ??
        0
    );


    setText(
        "fmExact",
        fm.exact_distinct_localities
        ?? 0
    );


    setText(
        "fmEstimated",
        fm.fm_estimated_distinct_localities
        ?? 0
    );


    setText(
        "fmError",
        fm.absolute_error
        ?? 0
    );


    setText(
        "fmPercentage",
        `${fm.percentage_error ?? 0}%`
    );

}


/* =========================================================
   ALERT SUMMARY
   ========================================================= */

function updateAlertSummary() {

    const bloomSummary =
        document.getElementById(
            "alertSummaryBloom"
        );

    if (bloomSummary) {

        bloomSummary.textContent =
            bloomData.length;

    }


    const dgimAlerts =
        dgimData.filter(
            item =>
                String(
                    item.status
                )
                    .toUpperCase()
                    .includes(
                        "SPIKE"
                    )
        );


    const dgimSummary =
        document.getElementById(
            "alertSummaryDGIM"
        );

    if (dgimSummary) {

        dgimSummary.textContent =
            dgimAlerts.length;

    }


    const estimated =
        fmData.length > 0

            ? (
                fmData[0]
                    .fm_estimated_distinct_localities
                ?? 0
            )

            : 0;


    const fmSummary =
        document.getElementById(
            "alertSummaryFM"
        );

    if (fmSummary) {

        fmSummary.textContent =
            estimated;

    }

}


/* =========================================================
   HOSPITAL CAPACITY
   ========================================================= */

function renderCapacityMetricFilter() {

    const select =
        document.getElementById(
            "capacityMetricFilter"
        );


    if (!select) {
        return;
    }


    const previousValue =
        select.value;


    const metrics =
        [
            ...new Set(

                capacityData
                    .map(
                        item =>
                            String(
                                item.metric ||
                                ""
                            ).trim()
                    )
                    .filter(
                        Boolean
                    )

            )
        ].sort(
            (
                a,
                b
            ) =>
                a.localeCompare(
                    b
                )
        );


    select.innerHTML = "";


    if (
        metrics.length === 0
    ) {

        const option =
            document.createElement(
                "option"
            );


        option.value = "";

        option.textContent =
            "No metrics available";


        select.appendChild(
            option
        );


        select.disabled = true;

        return;

    }


    select.disabled = false;


    /*
     * Individual metric options.
     */

    metrics.forEach(
        metric => {

            const option =
                document.createElement(
                    "option"
                );


            option.value =
                metric;


            option.textContent =
                metric;


            select.appendChild(
                option
            );

        }
    );


    /*
     * All Events is intentionally added
     * after individual metrics.
     *
     * IMPORTANT:
     * It represents a combined view of ALL metrics,
     * not another individual metric.
     */

    const allEventsOption =
        document.createElement(
            "option"
        );


    allEventsOption.value =
        "all";


    allEventsOption.textContent =
        "All Events";


    select.appendChild(
        allEventsOption
    );


    select.value =
        previousValue === "all"

            ? "all"

            : metrics.includes(
                previousValue
            )

                ? previousValue

                : metrics[0];

}


/* =========================================================
   CAPACITY FILTERED DATA
   ========================================================= */

function getFilteredCapacityData() {

    const selectedMetric =
        document.getElementById(
            "capacityMetricFilter"
        )?.value || "";


    return capacityData.filter(
        item =>

            !selectedMetric ||

            selectedMetric === "all" ||

            String(
                item.metric || ""
            ) ===
            selectedMetric

    );

}


/* =========================================================
   CAPACITY CHART
   =========================================================
   
   IMPORTANT DIFFERENCE:
   
   Individual Metric:
       X-axis = Bed Type
       Value = total value for that selected metric
   
   All Events:
       X-axis = Metric
       Value = total value across bed types
   
   This makes "All Events" visually different from
   selecting one individual metric.
   ========================================================= */

function renderCapacityChart() {

    const canvas =
        document.getElementById(
            "capacityChart"
        );


    if (!canvas) {
        return;
    }


    const selectedMetric =
        document.getElementById(
            "capacityMetricFilter"
        )?.value || "";


    const filtered =
        getFilteredCapacityData();


    if (capacityChart) {

        capacityChart.destroy();

        capacityChart = null;

    }


    const ctx =
        canvas.getContext(
            "2d"
        );


    if (ctx) {

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

    }


    if (
        filtered.length === 0
    ) {

        return;

    }


    /*
     * =====================================================
     * ALL EVENTS VIEW
     * =====================================================
     *
     * Group by metric instead of bed type.
     */

    if (
        selectedMetric === "all"
    ) {

        const grouped =
            new Map();


        filtered.forEach(
            item => {

                const metric =
                    String(
                        item.metric ||
                        "Unspecified"
                    );


                const value =
                    Number(
                        item.value
                    );


                if (
                    !Number.isFinite(
                        value
                    )
                ) {

                    return;

                }


                grouped.set(
                    metric,
                    (
                        grouped.get(
                            metric
                        ) || 0
                    ) +
                    value
                );

            }
        );


        const labels =
            [...grouped.keys()];


        const values =
            [...grouped.values()];


        if (
            labels.length === 0
        ) {

            return;

        }


        capacityChart =
            new Chart(
                canvas,
                {

                    type: "bar",

                    data: {

                        labels: labels,

                        datasets: [{

                            label:
                                "All Events - Total Reported Value",

                            data: values,

                            backgroundColor:
                                "rgba(124, 58, 237, 0.75)",

                            borderColor:
                                "rgb(124, 58, 237)",

                            borderWidth: 1,

                            borderRadius: 6

                        }]

                    },

                    options: {

                        responsive: true,

                        maintainAspectRatio: false,

                        plugins: {

                            legend: {

                                display: true

                            },

                            title: {

                                display: true,

                                text:
                                    "All Hospital Capacity Metrics"

                            },

                            tooltip: {

                                callbacks: {

                                    label:
                                        context =>
                                            ` Total: ${Number(
                                                context.raw
                                            ).toLocaleString()}`

                                }

                            }

                        },

                        scales: {

                            x: {

                                title: {

                                    display: true,

                                    text:
                                        "Capacity Metric"

                                }

                            },

                            y: {

                                beginAtZero: true,

                                title: {

                                    display: true,

                                    text:
                                        "Combined Reported Value"

                                }

                            }

                        }

                    }

                }
            );


        return;

    }


    /*
     * =====================================================
     * INDIVIDUAL METRIC VIEW
     * =====================================================
     *
     * Group by bed type.
     */

    const grouped =
        new Map();


    filtered.forEach(
        item => {

            const key =
                String(
                    item.bed_type ||
                    "Unspecified"
                );


            const value =
                Number(
                    item.value
                );


            if (
                !Number.isFinite(
                    value
                )
            ) {

                return;

            }


            grouped.set(
                key,
                (
                    grouped.get(
                        key
                    ) || 0
                ) +
                value
            );

        }
    );


    const labels =
        [...grouped.keys()];


    const values =
        [...grouped.values()];


    if (
        labels.length === 0
    ) {

        return;

    }


    capacityChart =
        new Chart(
            canvas,
            {

                type: "bar",

                data: {

                    labels: labels,

                    datasets: [{

                        label:
                            `${selectedMetric} - Reported Value`,

                        data: values,

                        backgroundColor:
                            "rgba(13, 148, 136, 0.75)",

                        borderColor:
                            "rgb(13, 148, 136)",

                        borderWidth: 1,

                        borderRadius: 6

                    }]

                },

                options: {

                    responsive: true,

                    maintainAspectRatio: false,

                    plugins: {

                        legend: {

                            display: true

                        },

                        title: {

                            display: true,

                            text:
                                `${selectedMetric} by Bed Type`

                        },

                        tooltip: {

                            callbacks: {

                                label:
                                    context =>
                                        ` Reported value: ${Number(
                                            context.raw
                                        ).toLocaleString()}`

                            }

                        }

                    },

                    scales: {

                        x: {

                            title: {

                                display: true,

                                text:
                                    "Bed Type"

                            }

                        },

                        y: {

                            beginAtZero: true,

                            title: {

                                display: true,

                                text:
                                    "Reported Value"

                            }

                        }

                    }

                }

            }
        );

}


/* =========================================================
   CAPACITY TABLE
   ========================================================= */

function renderCapacityTable() {

    const table =
        document.getElementById(
            "capacityTable"
        );


    if (!table) {
        return;
    }


    const filtered =
        getFilteredCapacityData();


    const count =
        document.getElementById(
            "capacityRecordCount"
        );


    const snapshot =
        document.getElementById(
            "capacitySnapshotLabel"
        );


    if (count) {

        count.textContent =
            `${filtered.length.toLocaleString()} records`;

    }


    if (snapshot) {

        const periods =
            [
                ...new Set(

                    filtered
                        .map(
                            item =>
                                item.period
                        )
                        .filter(
                            Boolean
                        )

                )
            ].sort();


        const levels =
            [
                ...new Set(

                    filtered
                        .map(
                            item =>
                                item.level
                        )
                        .filter(
                            Boolean
                        )

                )
            ].sort();


        const periodText =
            periods.length

                ? periods.join(", ")

                : "Period unavailable";


        const levelText =
            levels.length

                ? levels.join(", ")

                : "Geographic level unavailable";


        snapshot.textContent =
            `Snapshot period: ${periodText} | Level: ${levelText}`;

    }


    table.innerHTML = "";


    if (
        filtered.length === 0
    ) {

        table.innerHTML = `

            <tr>

                <td
                    colspan="6"
                    class="empty-state">

                    No hospital capacity records
                    are available for this metric.

                </td>

            </tr>

        `;


        renderCapacityPagination(
            0,
            0
        );

        return;

    }


    const totalPages =
        Math.ceil(
            filtered.length /
            capacityRowsPerPage
        );


    if (
        capacityCurrentPage >
            totalPages
        &&
        totalPages > 0
    ) {

        capacityCurrentPage =
            totalPages;

    }


    if (
        totalPages === 0
    ) {

        capacityCurrentPage = 1;

    }


    const startIndex =
        (
            capacityCurrentPage - 1
        ) *
        capacityRowsPerPage;


    const endIndex =
        startIndex +
        capacityRowsPerPage;


    const pageData =
        filtered.slice(
            startIndex,
            endIndex
        );


    pageData.forEach(
        item => {

            const location =
                item.org_name ||
                item.region ||
                item.icb ||
                item.org_code ||
                "—";


            const row =
                document.createElement(
                    "tr"
                );


            row.innerHTML = `

                <td>
                    ${escapeHtml(
                        item.period ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        item.level ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        location
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        item.metric ||
                        "—"
                    )}
                </td>

                <td>
                    ${escapeHtml(
                        item.bed_type ||
                        "—"
                    )}
                </td>

                <td
                    class="text-end">

                    ${
                        Number.isFinite(
                            Number(
                                item.value
                            )
                        )

                        ? Number(
                            item.value
                        ).toLocaleString(
                            undefined,
                            {
                                maximumFractionDigits: 2
                            }
                        )

                        : escapeHtml(
                            item.value ??
                            "—"
                        )
                    }

                </td>

            `;


            table.appendChild(
                row
            );

        }
    );


    renderCapacityPagination(
        filtered.length,
        totalPages
    );

}


/* =========================================================
   CAPACITY PAGINATION
   ========================================================= */

function renderCapacityPagination(
    totalRecords,
    totalPages
) {

    const oldPagination =
        document.getElementById(
            "capacityPagination"
        );


    if (oldPagination) {

        oldPagination.remove();

    }


    const table =
        document.getElementById(
            "capacityTable"
        );


    if (!table) {
        return;
    }


    const tableResponsive =
        table.closest(
            ".table-responsive"
        );


    if (!tableResponsive) {
        return;
    }


    const pagination =
        document.createElement(
            "div"
        );


    pagination.id =
        "capacityPagination";


    pagination.className =
        "d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 mb-2";


    const info =
        document.createElement(
            "div"
        );


    info.className =
        "text-muted small";


    if (
        totalRecords > 0
    ) {

        const start =
            (
                capacityCurrentPage - 1
            ) *
            capacityRowsPerPage +
            1;


        const end =
            Math.min(
                capacityCurrentPage *
                    capacityRowsPerPage,
                totalRecords
            );


        info.textContent =
            `Showing ${start}-${end} of ${totalRecords} capacity records`;

    }

    else {

        info.textContent =
            "No capacity records";

    }


    const controls =
        document.createElement(
            "div"
        );


    controls.className =
        "d-flex align-items-center gap-1 flex-wrap";


    const previousButton =
        document.createElement(
            "button"
        );


    previousButton.type =
        "button";


    previousButton.className =
        "btn btn-sm btn-outline-primary";


    previousButton.innerHTML =
        `<i class="bi bi-chevron-left"></i> Previous`;


    previousButton.disabled =
        capacityCurrentPage <= 1;


    previousButton.addEventListener(
        "click",
        () => {

            if (
                capacityCurrentPage > 1
            ) {

                capacityCurrentPage--;

                renderCapacityTable();

            }

        }
    );


    controls.appendChild(
        previousButton
    );


    for (
        let page = 1;
        page <= totalPages;
        page++
    ) {

        const pageButton =
            document.createElement(
                "button"
            );


        pageButton.type =
            "button";


        pageButton.className =
            page ===
            capacityCurrentPage

                ? "btn btn-sm btn-primary"

                : "btn btn-sm btn-outline-primary";


        pageButton.textContent =
            page;


        pageButton.addEventListener(
            "click",
            () => {

                capacityCurrentPage =
                    page;

                renderCapacityTable();

            }
        );


        controls.appendChild(
            pageButton
        );

    }


    const nextButton =
        document.createElement(
            "button"
        );


    nextButton.type =
        "button";


    nextButton.className =
        "btn btn-sm btn-outline-primary";


    nextButton.innerHTML =
        `Next <i class="bi bi-chevron-right"></i>`;


    nextButton.disabled =
        capacityCurrentPage >=
        totalPages;


    nextButton.addEventListener(
        "click",
        () => {

            if (
                capacityCurrentPage <
                totalPages
            ) {

                capacityCurrentPage++;

                renderCapacityTable();

            }

        }
    );


    controls.appendChild(
        nextButton
    );


    pagination.appendChild(
        info
    );


    pagination.appendChild(
        controls
    );


    tableResponsive.insertAdjacentElement(
        "afterend",
        pagination
    );

}


/* =========================================================
   TABS
   ========================================================= */

function setupTabs() {

    const tabs =
        document.querySelectorAll(
            ".dashboard-tab"
        );


    tabs.forEach(
        tab => {

            tab.addEventListener(
                "click",
                () => {

                    const target =
                        tab.dataset.tab;


                    tabs.forEach(
                        item =>
                            item.classList.remove(
                                "active"
                            )
                    );


                    tab.classList.add(
                        "active"
                    );


                    document
                        .querySelectorAll(
                            ".dashboard-section"
                        )
                        .forEach(
                            section =>
                                section.classList.remove(
                                    "active"
                                )
                        );


                    const section =
                        document.getElementById(
                            `${target}Section`
                        );


                    if (section) {

                        section.classList.add(
                            "active"
                        );

                    }

                }
            );

        }
    );

}


/* =========================================================
   FILTERS
   ========================================================= */

function setupFilters() {

    document
        .getElementById(
            "diseaseSearch"
        )
        ?.addEventListener(
            "input",
            () => {

                diseaseCurrentPage = 1;

                renderDiseaseTable();

            }
        );


    document
        .getElementById(
            "diseaseSort"
        )
        ?.addEventListener(
            "change",
            () => {

                diseaseCurrentPage = 1;

                renderDiseaseChart();

                renderDiseaseTable();

            }
        );


    document
        .getElementById(
            "bloomFilter"
        )
        ?.addEventListener(
            "change",
            renderBloomAlerts
        );


    document
        .getElementById(
            "dgimFilter"
        )
        ?.addEventListener(
            "change",
            renderDGIMTable
        );


    document
        .getElementById(
            "capacityMetricFilter"
        )
        ?.addEventListener(
            "change",
            () => {

                capacityCurrentPage = 1;

                renderCapacityChart();

                renderCapacityTable();

            }
        );

}


/* =========================================================
   REFRESH BUTTON
   ========================================================= */

function setupRefreshButton() {

    const button =
        document.getElementById(
            "refreshButton"
        );


    if (!button) {
        return;
    }


    button.addEventListener(
        "click",
        loadDashboardData
    );

}


/* =========================================================
   KPI CARD NAVIGATION
   ========================================================= */

function setupKpiCards() {

    document
        .querySelectorAll(
            ".kpi-card"
        )
        .forEach(
            card => {

                card.addEventListener(
                    "click",
                    () => {

                        const section =
                            card.dataset.section;


                        if (!section) {
                            return;
                        }


                        const tab =
                            document.querySelector(
                                `.dashboard-tab[data-tab="${section}"]`
                            );


                        if (tab) {

                            tab.click();

                        }

                    }
                );

            }
        );

}


/* =========================================================
   REFRESH STATE
   ========================================================= */

function setRefreshState(
    isLoading
) {

    const button =
        document.getElementById(
            "refreshButton"
        );


    if (!button) {
        return;
    }


    if (isLoading) {

        button.disabled =
            true;


        button.innerHTML = `

            <span
                class="spinner-border spinner-border-sm me-1">

            </span>

            Loading...

        `;

    }

    else {

        button.disabled =
            false;


        button.innerHTML = `

            <i class="bi bi-arrow-clockwise"></i>

            Refresh Data

        `;

    }

}


/* =========================================================
   TIMESTAMP
   ========================================================= */

function updateTimestamp() {

    const element =
        document.getElementById(
            "lastUpdated"
        );


    if (!element) {
        return;
    }


    const now =
        new Date();


    element.textContent =
        `Last updated: ${now.toLocaleTimeString()}`;

}


/* =========================================================
   ERROR DISPLAY
   ========================================================= */

function showDashboardError(
    error
) {

    const container =
        document.getElementById(
            "bloomAlertsList"
        );


    if (!container) {
        return;
    }


    container.innerHTML = `

        <div
            class="alert alert-danger">

            <strong>
                Dashboard data error
            </strong>

            <br>

            ${escapeHtml(
                error?.message ||
                "Unknown error"
            )}

        </div>

    `;

}


/* =========================================================
   UTILITY FUNCTIONS
   ========================================================= */

function shortenDiseaseName(
    name
) {

    const text =
        String(
            name || ""
        );


    if (
        text.length <= 28
    ) {

        return text;

    }


    return (
        text.substring(
            0,
            25
        ) +
        "..."
    );

}


function escapeHtml(
    value
) {

    const div =
        document.createElement(
            "div"
        );


    div.textContent =
        String(
            value ?? ""
        );


    return div.innerHTML;

}


/* =========================================================
   INTERACTIVE STREAMING ALGORITHM IMPLEMENTATION
   ========================================================= */

function setupStreamingImplementation() {

    const form =
        document.getElementById(
            "streamEventForm"
        );


    const resetButton =
        document.getElementById(
            "streamResetButton"
        );


    if (form) {

        form.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                await submitStreamingEvent();

            }
        );

    }


    if (resetButton) {

        resetButton.addEventListener(
            "click",
            resetStreamingEventStream
        );

    }

}


/* =========================================================
   SUBMIT STREAM EVENT
   ========================================================= */

async function submitStreamingEvent() {

    const disease =
        document
            .getElementById(
                "streamDisease"
            )
            ?.value
            .trim();


    const patientId =
        document
            .getElementById(
                "streamPatientId"
            )
            ?.value
            .trim();


    const locality =
        document
            .getElementById(
                "streamLocality"
            )
            ?.value
            .trim();


    const button =
        document.getElementById(
            "streamAnalyzeButton"
        );


    const status =
        document.getElementById(
            "streamImplementationStatus"
        );


    if (
        !disease ||
        !patientId ||
        !locality
    ) {

        showStreamingError(
            "Please enter Disease, Patient ID and Locality."
        );

        return;

    }


    if (button) {

        button.disabled =
            true;


        button.innerHTML =
            '<span class="spinner-border spinner-border-sm me-1"></span> Running...';

    }


    if (status) {

        status.className =
            "badge bg-info text-dark";

        status.textContent =
            "Processing";

    }


    hideStreamingError();


    try {

        const response =
            await fetch(
                "/api/stream/analyze",
                {

                    method:
                        "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify({

                            disease:
                                disease,

                            patient_id:
                                patientId,

                            locality:
                                locality

                        })

                }
            );


        /*
         * IMPORTANT:
         * Do not call response.json() directly.
         *
         * If Flask returns an HTML error page,
         * response.json() causes:
         *
         * Unexpected token '<'
         */

        const result =
            await parseJsonResponse(
                response
            );


        if (!response.ok) {

            throw new Error(
                result?.error ||
                "Streaming analysis failed."
            );

        }


        renderStreamingImplementation(
            result
        );


        if (status) {

            status.className =
                "badge bg-success";

            status.textContent =
                `Event #${result.event.event_number} processed`;

        }


        /*
         * Refresh existing monitoring
         * components so the newly inserted
         * event becomes visible.
         */

        await refreshStreamingMonitorData();


    }

    catch (error) {

        console.error(
            "Streaming implementation error:",
            error
        );


        showStreamingError(
            error.message
        );


        if (status) {

            status.className =
                "badge bg-danger";

            status.textContent =
                "Error";

        }

    }

    finally {

        if (button) {

            button.disabled =
                false;


            button.innerHTML =
                '<i class="bi bi-play-circle me-1"></i> Analyze Event';

        }

    }

}


/* =========================================================
   RENDER STREAMING IMPLEMENTATION
   ========================================================= */

function renderStreamingImplementation(
    result
) {

    const results =
        document.getElementById(
            "streamImplementationResults"
        );


    if (results) {

        results.classList.remove(
            "d-none"
        );

    }


    const bloom =
        result.bloom || {};


    const dgim =
        result.dgim || {};


    const fm =
        result.fm || {};


    /* =====================================================
       BLOOM FILTER
       ===================================================== */

    const bloomDecision =
        document.getElementById(
            "streamBloomDecision"
        );


    if (bloomDecision) {

        bloomDecision.textContent =
            bloom.possibly_notifiable

                ? "POSSIBLY NOTIFIABLE"

                : "NOT FLAGGED";


        bloomDecision.className =
            bloom.possibly_notifiable

                ? "algorithm-decision text-danger"

                : "algorithm-decision text-success";

    }


    setText(
        "streamBloomPositions",
        (
            bloom.positions || []
        ).join(", ")
    );


    setText(
        "streamBloomBits",
        (
            bloom.bits_at_positions || []
        ).join(", ")
    );


    setText(
        "streamBloomSize",
        `${bloom.filter_size || 0} bits / ${bloom.hash_functions || 0} hash functions`
    );


    setText(
        "streamBloomExplanation",

        bloom.confirmed_by_list

            ? "The entered disease is in the predefined notifiable-disease set. The Bloom Filter checks its three hash positions; because all corresponding bits are 1, the event is flagged."

            : "The entered disease is not in the predefined list. A Bloom Filter can return a possible match because of collisions, so this result is interpreted as a possible membership test rather than proof."

    );


    /* =====================================================
       DGIM
       ===================================================== */

    const dgimDecision =
        document.getElementById(
            "streamDGIMDecision"
        );


    if (dgimDecision) {

        dgimDecision.textContent =
            dgim.status ||
            "NORMAL";


        dgimDecision.className =
            String(
                dgim.status || ""
            )
                .toUpperCase()
                .includes(
                    "SPIKE"
                )

                ? "algorithm-decision text-danger"

                : "algorithm-decision text-success";

    }


    setText(
        "streamDGIMWindow",
        `${dgim.window_size || 0} events`
    );


    setText(
        "streamDGIMEstimate",
        dgim.estimated_cases ??
        0
    );


    setText(
        "streamDGIMExact",
        dgim.exact_cases_in_window ??
        0
    );


    setText(
        "streamDGIMBits",
        (
            dgim.binary_stream_tail ||
            []
        ).join(" ")
    );


    setText(
        "streamDGIMBuckets",

        (
            dgim.buckets || []
        )
            .map(
                bucket =>
                    `[t${bucket.timestamp}: ${bucket.size}]`
            )
            .join(" ")
            ||
            "No buckets"
    );


    setText(
        "streamDGIMExplanation",

        `DGIM converts the selected disease into a binary stream (1 = matching case, 0 = other event), keeps compact buckets, and estimates the last ${dgim.window_size || 0} events. Threshold = ${dgim.spike_threshold || 6}.`

    );


    /* =====================================================
       FLAJOLET-MARTIN
       ===================================================== */

    setText(
        "streamFMEstimate",
        fm.estimated_distinct_localities ??
        0
    );


    setText(
        "streamFMExact",
        fm.exact_distinct_localities ??
        0
    );


    setText(
        "streamFMRho",
        fm.max_rho ??
        0
    );


    setText(
        "streamFMError",
        fm.absolute_error ??
        0
    );


    setText(
        "streamFMPercentage",
        `${fm.percentage_error ?? 0}%`
    );


    const hashExample =
        (
            fm.hash_examples || []
        ).slice(
            -1
        )[0];


    setText(
        "streamFMHash",

        hashExample

            ? `${hashExample.locality} → ${hashExample.hash_prefix}, ρ=${hashExample.rho}`

            : "--"

    );


    setText(
        "streamFMExplanation",

        "Flajolet-Martin hashes each locality and records ρ, the position of the first 1-bit. The maximum ρ is used to estimate distinct localities without storing every unique value in the estimator. Exact distinct localities are shown only for comparison."

    );

}


/* =========================================================
   REFRESH STREAMING MONITOR DATA
   ========================================================= */

async function refreshStreamingMonitorData() {
    if (liveMode) {
        return;   // live stream is feeding these panels; do not overwrite with stored results
    }

    try {

        const [
            bloom,
            dgim,
            fm
        ] = await Promise.all([

            fetchJson(
                "/api/bloom-alerts"
            ),

            fetchJson(
                "/api/dgim-results"
            ),

            fetchJson(
                "/api/fm-results"
            )

        ]);


        bloomData =
            Array.isArray(
                bloom
            )

                ? bloom

                : bloomData;


        dgimData =
            Array.isArray(
                dgim
            )

                ? dgim

                : dgimData;


        fmData =
            Array.isArray(
                fm
            )

                ? fm

                : fmData;


        renderBloomAlerts();

        renderDGIMChart();

        renderDGIMTable();

        renderFMResults();

        updateAlertSummary();


    }

    catch (error) {

        console.warn(
            "Existing monitor refresh skipped:",
            error
        );

    }

}


/* =========================================================
   RESET STREAM
   ========================================================= */

async function resetStreamingEventStream() {

    if (
        !window.confirm(
            "Clear all dashboard-entered streaming events?"
        )
    ) {

        return;

    }


    try {

        const response =
            await fetch(
                "/api/stream/reset",
                {
                    method:
                        "POST"
                }
            );


        /*
         * Use robust parser here as well.
         */

        const result =
            await parseJsonResponse(
                response
            );


        if (!response.ok) {

            throw new Error(
                result?.error ||
                "Unable to reset stream."
            );

        }


        const results =
            document.getElementById(
                "streamImplementationResults"
            );


        if (results) {

            results.classList.add(
                "d-none"
            );

        }


        setText(
            "streamImplementationStatus",
            "Ready"
        );


        const status =
            document.getElementById(
                "streamImplementationStatus"
            );


        if (status) {

            status.className =
                "badge bg-secondary";

        }


        hideStreamingError();


        /*
         * Also clear the locally displayed
         * interactive monitoring data.
         */

        console.log(
            `Cleared ${result.deleted || 0} interactive stream events.`
        );

    }

    catch (error) {

        console.error(
            "Stream reset error:",
            error
        );

        showStreamingError(
            error.message
        );

    }

}


/* =========================================================
   STREAMING ERROR
   ========================================================= */

function showStreamingError(
    message
) {

    const box =
        document.getElementById(
            "streamImplementationError"
        );


    if (!box) {
        return;
    }


    box.textContent =
        message;


    box.classList.remove(
        "d-none"
    );

}


function hideStreamingError() {

    const box =
        document.getElementById(
            "streamImplementationError"
        );


    if (!box) {
        return;
    }


    box.textContent =
        "";


    box.classList.add(
        "d-none"
    );

}


/* =========================================================
   SET TEXT
   ========================================================= */

function setText(
    id,
    value
) {

    const element =
        document.getElementById(
            id
        );


    if (element) {

        element.textContent =
            value;

    }

}

/* =========================================================
   LIVE STREAM -> MONITORING PANELS
   live.js calls window.healthPulseLive.update(state) after every poll.
   Case Monitoring chart, Case Event Monitor table and the
   Distinct (Locality/Patient) panel then show the live stream
   instead of the stored results.
   ========================================================= */

const LIVE_MAX_ROWS = 300;
const LIVE_MAX_ALERTS = 200;

function setTextIfPresent(id, text) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = text;
    }
}

function resetFmLabels() {
    restoreBloomFilterOptions();
    setTextIfPresent("alertSummaryFMLabel", "Estimated Localities");
    setTextIfPresent("alertNote", "Disease alerts and locality monitoring use simulated stream data.");
    setTextIfPresent("kpiDiseaseDesc", "Historical patient analysis");
    setTextIfPresent("kpiAlertsDesc", "Notifiable disease alerts");
    setTextIfPresent("kpiCasesDesc", "Recent case activity");
    setTextIfPresent("kpiLocTitle", "Estimated Localities");
    setTextIfPresent("kpiLocDesc", "Distinct affected localities");
    setTextIfPresent("fmTitle", "Distinct Locality Analysis");
    setTextIfPresent("fmExactLabel", "Exact Localities");
    setTextIfPresent("fmEstimatedLabel", "Estimated Localities");
    setTextIfPresent("fmPatientsLabel", "Patient Records");
    setTextIfPresent("fmNote", "Locality information is simulated for demonstration purposes.");
    setTextIfPresent("dgimSubtitle", "Chronological monitoring of patient case activity");
}

function applyLiveFmLabels(state) {
    const patients = state.source === "mimic";
    const noun = patients ? "Patients" : "Localities";
    setTextIfPresent("fmTitle", `Distinct ${noun} Analysis`);
    setTextIfPresent("fmExactLabel", `Exact ${noun}`);
    setTextIfPresent("fmEstimatedLabel", `Estimated ${noun}`);
    setTextIfPresent("fmPatientsLabel", "Events Processed");
    setTextIfPresent(
        "fmNote",
        patients
            ? "Live MIMIC-IV replay: counting distinct patients (the dataset has no locality field)."
            : "Live simulated stream: localities are simulated."
    );
    setTextIfPresent(
        "dgimSubtitle",
        `LIVE: estimated cases (last ${state.watched.window_size} events) as each admission arrives`
    );
}

window.healthPulseLive = {

    /* Called when Start is pressed: drop the stored results, begin a fresh live series. */
    reset() {
        liveMode = true;
        dgimData = [];
        fmData = [];
        bloomData = [];
        applyLiveRender();
    },

    /* Called after every poll with the /api/stream/live/state payload. */
    update(state) {
        if (!liveMode) {
            liveMode = true;      // e.g. page reloaded while a stream was already running
            dgimData = [];
            bloomData = [];
        }

        const events = state.events || [];
        const n = events.length;

        events.forEach((e, i) => {
            dgimData.push({
                event_number: state.processed - (n - 1 - i),
                admittime: e.time,
                disease: e.disease,
                estimated_cases: e.dgim_estimate,
                status: e.status
            });
        });

        if (dgimData.length > LIVE_MAX_ROWS) {
            dgimData = dgimData.slice(-LIVE_MAX_ROWS);
        }

        fmData = [{
            total_patient_records: state.processed,
            exact_distinct_localities: state.fm.exact_distinct_localities,
            fm_estimated_distinct_localities: state.fm.estimated_distinct_localities,
            absolute_error: state.fm.absolute_error,
            percentage_error: state.fm.percentage_error
        }];

        // Notifiable Disease Alerts: every event the Bloom filter flagged
        events.filter(e => e.bloom_flag).forEach(e => {
            bloomData.push({
                timestamp: e.time,
                patient_id: e.patient_id ?? "-",
                disease: e.detail || e.disease,
                locality: e.locality,
                alert: "POSSIBLY NOTIFIABLE"
            });
        });
        if (bloomData.length > LIVE_MAX_ALERTS) {
            bloomData = bloomData.slice(-LIVE_MAX_ALERTS);
        }

        applyLiveFmLabels(state);
        applyLiveKpis(state);
        applyLiveAlerts(state);
        applyLiveRender();
    }
};

/* Top summary cards: Disease Records, Disease Alerts, Case Monitoring, Estimated Localities/Patients. */
function applyLiveKpis(state) {
    const patients = state.source === "mimic";
    setTextIfPresent("diseaseRecords", state.distinct_diseases ?? 0);
    setTextIfPresent("kpiDiseaseDesc", patients ? "Distinct diagnosis groups seen" : "Distinct diseases seen");
    setTextIfPresent("bloomAlerts", state.flagged);
    setTextIfPresent("kpiAlertsDesc", "Flagged by Bloom filter");
    setTextIfPresent("dgimRecords", state.processed);
    setTextIfPresent("kpiCasesDesc", "Events processed");
    setTextIfPresent("fmLocalities", state.fm.estimated_distinct_localities);
    setTextIfPresent("kpiLocTitle", patients ? "Estimated Patients" : "Estimated Localities");
    setTextIfPresent("kpiLocDesc", patients ? "Distinct patients (estimate)" : "Distinct localities (estimate)");
}

/* Alerts tab: Notifiable Disease Alerts list, its disease filter, and the Alert Summary. */
let bloomFilterOriginal = null;
let bloomFilterKey = "";

function syncBloomFilterOptions() {
    const sel = document.getElementById("bloomFilter");
    if (!sel) {
        return;
    }
    if (bloomFilterOriginal === null) {
        bloomFilterOriginal = sel.innerHTML;
    }
    const names = [...new Set(bloomData.map(item => item.disease))].sort();
    const key = names.join("|");
    if (key === bloomFilterKey) {
        return;                       // same diseases as before: leave an open dropdown alone
    }
    bloomFilterKey = key;
    const current = sel.value;
    sel.innerHTML = "";
    sel.add(new Option("All Diseases", "all"));
    names.forEach(name => sel.add(new Option(name, name)));
    sel.value = (current === "all" || names.includes(current)) ? current : "all";
}

function restoreBloomFilterOptions() {
    const sel = document.getElementById("bloomFilter");
    if (sel && bloomFilterOriginal !== null) {
        sel.innerHTML = bloomFilterOriginal;
        sel.value = "all";
    }
    bloomFilterOriginal = null;
    bloomFilterKey = "";
}

function applyLiveAlerts(state) {
    const patients = state.source === "mimic";
    syncBloomFilterOptions();
    renderBloomAlerts();
    setTextIfPresent("alertSummaryBloom", state.flagged);
    setTextIfPresent("alertSummaryDGIM", state.spikes ?? 0);
    setTextIfPresent("alertSummaryFM", state.fm.estimated_distinct_localities);
    setTextIfPresent("alertSummaryFMLabel", patients ? "Estimated Patients" : "Estimated Localities");
    setTextIfPresent(
        "alertNote",
        patients
            ? "Live MIMIC-IV replay: alerts are diagnoses the Bloom filter matched against the reportable-condition list."
            : "Live simulated stream: diseases, patients and localities are simulated."
    );
}

function applyLiveRender() {
    renderDGIMChart();
    renderDGIMTable();
    renderFMResults();
}