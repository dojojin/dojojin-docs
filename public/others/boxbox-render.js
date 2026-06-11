// ============================================================
// Vigil Platform — BoxBox Architecture Diagram Renderer
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================
// Loaded as <script src="./boxbox-render.js" data-json="./boxbox-XX-data.json">.
// Reads data-json attribute, fetches the JSON, then initialises Cytoscape.
// document.currentScript is captured synchronously before the async fetch.
(function () {
  const scriptEl = document.currentScript;
  const jsonUrl = scriptEl && scriptEl.getAttribute('data-json');
  if (!jsonUrl) return;

  fetch(jsonUrl)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (DATA) {
      const LAYER_COLORS = {
        frontend: '#3b82f6', api: '#8b5cf6', backend: '#10b981',
        database: '#f59e0b', external: '#ec4899'
      };
      const LAYER_LABEL = DATA.layer_labels || {
        frontend: 'User interface', api: 'Server endpoints',
        backend: 'Business logic', database: 'Data storage',
        external: 'Outside services'
      };
      const UI = DATA.ui || {
        no_incoming: 'Nothing comes in.',
        no_outgoing: 'Nothing goes out.',
        no_files: '(no files associated)',
        connects_here: 'connects here',
        sends_to: 'sends to',
        theme_dark: 'Dark mode',
        theme_light: 'Light mode'
      };

      document.getElementById('project-name').textContent = DATA.project_name || 'System Map';
      document.getElementById('headline').textContent =
        (DATA.summary && DATA.summary.headline) || '';

      const stackEl = document.getElementById('stack');
      (DATA.stack || []).forEach(function (s) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = s.name;
        stackEl.appendChild(b);
      });

      const legendEl = document.getElementById('legend');
      Object.entries(LAYER_LABEL).forEach(function ([k, v]) {
        const item = document.createElement('div');
        item.className = 'legend-item';
        const dot = document.createElement('span');
        dot.className = 'legend-dot';
        dot.style.background = LAYER_COLORS[k] || '#64748b';
        item.appendChild(dot);
        item.appendChild(document.createTextNode(v));
        legendEl.appendChild(item);
      });

      cytoscape.use(cytoscapeDagre);

      const elements = [
        ...DATA.nodes.map(function (n) {
          return {
            data: {
              id: n.id, label: n.name, plain: n.plain_english,
              layer: n.layer, files: n.files || [], external: !!n.external
            },
            classes: n.layer
          };
        }),
        ...DATA.edges.map(function (e) {
          return { data: { source: e.from, target: e.to, label: e.label || '', kind: e.kind } };
        })
      ];

      const cy = cytoscape({
        container: document.getElementById('cy'),
        elements,
        style: [
          { selector: 'node', style: {
            'shape': 'round-rectangle',
            'background-color': function (ele) { return LAYER_COLORS[ele.data('layer')] || '#64748b'; },
            'label': 'data(label)', 'color': '#ffffff',
            'text-valign': 'center', 'text-halign': 'center',
            'text-wrap': 'wrap', 'text-max-width': '140px',
            'font-size': 14, 'font-weight': 600,
            'width': 180, 'height': 70,
            'border-width': 0,
            'padding': 12,
            'text-outline-width': 0
          }},
          { selector: 'node:selected', style: { 'border-width': 4, 'border-color': '#f8fafc' }},
          { selector: 'edge', style: {
            'width': 2,
            'line-color': '#94a3b8',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1.4,
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': 11,
            'font-weight': 500,
            'color': '#0f172a',
            'text-background-color': '#ffffff',
            'text-background-opacity': 1,
            'text-background-padding': 5,
            'text-background-shape': 'round-rectangle',
            'text-border-color': '#e2e8f0',
            'text-border-width': 1,
            'text-border-opacity': 1,
            'text-margin-y': -4,
            'text-wrap': 'wrap',
            'text-max-width': '140px'
          }},
          { selector: 'edge:hover', style: {
            'line-color': '#0f172a', 'target-arrow-color': '#0f172a', 'width': 3
          }}
        ],
        layout: { name: 'dagre', rankDir: 'TB', nodeSep: 80, rankSep: 140, padding: 40, edgeSep: 30 },
        wheelSensitivity: 0.2
      });

      cy.on('tap', 'node', function (evt) {
        const n = evt.target;
        const d = n.data();
        document.getElementById('panel-name').textContent = d.label;
        const chip = document.getElementById('panel-chip');
        chip.textContent = LAYER_LABEL[d.layer] || d.layer;
        chip.style.background = LAYER_COLORS[d.layer] || '#64748b';
        document.getElementById('panel-explain').textContent = d.plain || '';

        const inDiv = document.getElementById('panel-in');
        const outDiv = document.getElementById('panel-out');
        inDiv.innerHTML = '';
        outDiv.innerHTML = '';

        n.incomers('edge').forEach(function (e) {
          const div = document.createElement('div');
          div.className = 'conn';
          div.textContent = e.source().data('label') + ' → ' + (e.data('label') || UI.connects_here);
          inDiv.appendChild(div);
        });
        n.outgoers('edge').forEach(function (e) {
          const div = document.createElement('div');
          div.className = 'conn';
          div.textContent = (e.data('label') || UI.sends_to) + ' → ' + e.target().data('label');
          outDiv.appendChild(div);
        });

        if (!inDiv.children.length) {
          const d2 = document.createElement('div');
          d2.className = 'conn';
          d2.style.color = 'var(--muted)';
          d2.textContent = UI.no_incoming;
          inDiv.appendChild(d2);
        }
        if (!outDiv.children.length) {
          const d2 = document.createElement('div');
          d2.className = 'conn';
          d2.style.color = 'var(--muted)';
          d2.textContent = UI.no_outgoing;
          outDiv.appendChild(d2);
        }

        const ul = document.getElementById('panel-files');
        ul.innerHTML = '';
        (d.files || []).forEach(function (f) {
          const li = document.createElement('li');
          li.textContent = f;
          ul.appendChild(li);
        });
        if (!ul.children.length) {
          const li = document.createElement('li');
          li.textContent = UI.no_files;
          ul.appendChild(li);
        }

        document.getElementById('panel').classList.add('open');
      });

      document.getElementById('close-btn').onclick = function () {
        document.getElementById('panel').classList.remove('open');
      };
      document.getElementById('fit-btn').onclick = function () { cy.fit(null, 40); };
      document.getElementById('reset-btn').onclick = function () {
        cy.fit(null, 40);
        cy.zoom({ level: 1 });
      };

      const themeBtn = document.getElementById('theme-btn');
      function applyEdgeTheme(mode) {
        const dark = mode === 'dark';
        cy.style()
          .selector('edge').style({
            'color': dark ? '#f1f5f9' : '#0f172a',
            'text-background-color': dark ? '#1e293b' : '#ffffff',
            'text-border-color': dark ? '#334155' : '#e2e8f0',
            'line-color': dark ? '#64748b' : '#94a3b8',
            'target-arrow-color': dark ? '#64748b' : '#94a3b8'
          })
          .selector('node:selected').style({
            'border-color': dark ? '#f8fafc' : '#0f172a'
          }).update();
      }
      themeBtn.onclick = function () {
        const html = document.documentElement;
        const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
        html.dataset.theme = next;
        themeBtn.textContent = next === 'dark' ? UI.theme_light : UI.theme_dark;
        applyEdgeTheme(next);
      };

      applyEdgeTheme(document.documentElement.dataset.theme);

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') document.getElementById('panel').classList.remove('open');
      });
    })
    .catch(function (err) {
      console.error('[boxbox-render] Failed to load diagram data:', err);
    });
}());
