import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { GraphData, GraphNode } from '../../../shared/types';

interface Props {
  refreshKey: number;
  onSelectUrl: (url: string) => void;
}

type Mode = 'force' | 'tree';

function statusColor(status: number | null): string {
  if (status === null || status === 0) return '#64748b';
  if (status >= 200 && status < 300) return '#10b981';
  if (status >= 300 && status < 400) return '#38bdf8';
  if (status >= 400 && status < 500) return '#f59e0b';
  if (status >= 500) return '#ef4444';
  return '#94a3b8';
}

// d3-force mutates node objects with x/y/vx/vy; model that locally.
type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode>;

export default function Visualization(props: Props): React.JSX.Element {
  const { onSelectUrl } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>('force');
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load graph data whenever a crawl finishes or the user switches to this tab.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.pulse
      .graph()
      .then((g) => {
        if (!cancelled) setData(g);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.refreshKey]);

  // ---- Force graph: canvas renderer (Obsidian-style) ------------------------
  // Canvas instead of SVG: crisp hairlines at native DPI, hover-highlighting
  // that fades unrelated edges (the fix for "grey fog" on dense nav meshes),
  // and it stays fast at thousands of nodes.
  useEffect(() => {
    if (mode !== 'force') return;
    const canvas = canvasRef.current;
    const tipEl = tipRef.current;
    if (!canvas || !data || data.nodes.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.edges.map((e) => ({ source: e.source, target: e.target }));

    // Size by inlinks over the dataset's RANGE: on small sites every page
    // shares the same nav, so max-normalising would make everything huge.
    const minIn = Math.min(...nodes.map((n) => n.inlinks));
    const maxIn = Math.max(...nodes.map((n) => n.inlinks));
    const rScale = d3.scaleSqrt().domain([minIn, Math.max(minIn + 1, maxIn)]).range([2.5, 9]);
    const r = (d: SimNode): number => (maxIn === minIn ? 4 : rScale(d.inlinks));

    // Dense meshes need stronger repulsion; link strength stays at d3's
    // degree-aware default, which weakens pull between highly-linked nodes.
    const density = links.length / Math.max(1, nodes.length);
    const charge = -60 - 30 * Math.min(5, density);

    const sim = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => 30 + r(l.source as SimNode) + r(l.target as SimNode))
      )
      .force('charge', d3.forceManyBody().strength(charge).distanceMax(400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<SimNode>().radius((d) => r(d) + 1.5).iterations(2))
      .stop();
    const ticks = Math.min(400, 120 + nodes.length);
    for (let i = 0; i < ticks; i++) sim.tick();

    // After the sim, link endpoints are node objects.
    const edges = links.map((l) => ({ s: l.source as SimNode, t: l.target as SimNode }));
    const neighbours = new Map<number, Set<number>>();
    for (const e of edges) {
      if (!neighbours.has(e.s.id)) neighbours.set(e.s.id, new Set());
      if (!neighbours.has(e.t.id)) neighbours.set(e.t.id, new Set());
      neighbours.get(e.s.id)!.add(e.t.id);
      neighbours.get(e.t.id)!.add(e.s.id);
    }
    const quadtree = d3
      .quadtree<SimNode>()
      .x((d) => d.x ?? 0)
      .y((d) => d.y ?? 0)
      .addAll(nodes);

    let transform = d3.zoomIdentity;
    let hovered: SimNode | null = null;

    const baseEdgeAlpha = Math.max(0.05, Math.min(0.35, 50 / Math.max(1, edges.length)));

    const draw = (): void => {
      const k = transform.k;
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      ctx.translate(transform.x, transform.y);
      ctx.scale(k, k);

      // Nodes grow sub-linearly with zoom (Obsidian-style) so zooming in
      // reveals structure instead of inflating circles.
      const nodeR = (d: SimNode): number => r(d) * Math.pow(k, -0.35);
      const hairline = 1 / k; // ≈1 CSS px at any zoom

      // Pass 1: unrelated edges (faded hard while hovering).
      ctx.lineWidth = hairline * 0.8;
      ctx.strokeStyle = '#64748b';
      ctx.globalAlpha = hovered ? Math.min(0.03, baseEdgeAlpha) : baseEdgeAlpha;
      ctx.beginPath();
      for (const e of edges) {
        if (hovered && (e.s.id === hovered.id || e.t.id === hovered.id)) continue;
        ctx.moveTo(e.s.x ?? 0, e.s.y ?? 0);
        ctx.lineTo(e.t.x ?? 0, e.t.y ?? 0);
      }
      ctx.stroke();

      // Pass 2: the hovered node's own edges, bright.
      if (hovered) {
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = hairline;
        ctx.beginPath();
        for (const e of edges) {
          if (e.s.id !== hovered.id && e.t.id !== hovered.id) continue;
          ctx.moveTo(e.s.x ?? 0, e.s.y ?? 0);
          ctx.lineTo(e.t.x ?? 0, e.t.y ?? 0);
        }
        ctx.stroke();
      }

      // Nodes. While hovering, non-neighbours fade.
      const hoodlum = hovered ? neighbours.get(hovered.id) : null;
      for (const d of nodes) {
        const isHover = hovered?.id === d.id;
        const related = !hovered || isHover || (hoodlum?.has(d.id) ?? false);
        ctx.globalAlpha = related ? (d.indexable === 1 ? 0.95 : 0.4) : 0.12;
        ctx.beginPath();
        ctx.arc(d.x ?? 0, d.y ?? 0, nodeR(d), 0, Math.PI * 2);
        ctx.fillStyle = statusColor(d.status);
        ctx.fill();
        ctx.lineWidth = hairline;
        ctx.strokeStyle = isHover ? '#f8fafc' : '#0f172a';
        ctx.stroke();
      }

      // Labels fade in as you zoom (viewport-culled, capped for sanity).
      if (k >= 1.2) {
        const alpha = Math.min(1, (k - 1.2) / 0.8);
        ctx.font = `${11 / k}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = '#cbd5e1';
        const [x0, y0] = transform.invert([0, 0]);
        const [x1, y1] = transform.invert([width, height]);
        let drawn = 0;
        for (const d of nodes) {
          if (drawn >= 300) break;
          const x = d.x ?? 0;
          const y = d.y ?? 0;
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          const related = !hovered || hovered.id === d.id || (hoodlum?.has(d.id) ?? false);
          ctx.globalAlpha = (related ? 0.9 : 0.15) * alpha;
          const label = d.path.length > 40 ? d.path.slice(0, 39) + '…' : d.path;
          ctx.fillText(label, x + nodeR(d) + 3 / k, y + 3.5 / k);
          drawn++;
        }
      }
      ctx.restore();
    };

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 12])
      .on('zoom', (ev) => {
        transform = ev.transform;
        draw();
      });
    const sel = d3.select(canvas);
    sel.call(zoom);

    // Fit the settled layout into view.
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const pad = 40;
    const spanX = Math.max(1, Math.max(...xs) - Math.min(...xs)) + pad * 2;
    const spanY = Math.max(1, Math.max(...ys) - Math.min(...ys)) + pad * 2;
    const fitK = Math.max(0.05, Math.min(1.5, Math.min(width / spanX, height / spanY)));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    sel.call(
      zoom.transform,
      d3.zoomIdentity.translate(width / 2 - cx * fitK, height / 2 - cy * fitK).scale(fitK)
    );

    const pick = (ev: MouseEvent): SimNode | null => {
      const rect = canvas.getBoundingClientRect();
      const [wx, wy] = transform.invert([ev.clientX - rect.left, ev.clientY - rect.top]);
      const found = quadtree.find(wx, wy, 14 / transform.k + 6);
      if (!found) return null;
      const dist = Math.hypot((found.x ?? 0) - wx, (found.y ?? 0) - wy);
      return dist <= r(found) + 6 / transform.k ? found : null;
    };

    const onMove = (ev: MouseEvent): void => {
      const hit = pick(ev);
      if (hit !== hovered) {
        hovered = hit;
        draw();
      }
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      if (tipEl) {
        if (hit) {
          tipEl.textContent = `${hit.url} — ${hit.status ?? '—'} · depth ${hit.depth ?? '—'} · in ${hit.inlinks} · out ${hit.outlinks}`;
          tipEl.style.display = 'block';
          const rect = canvas.getBoundingClientRect();
          tipEl.style.left = `${Math.min(ev.clientX - rect.left + 12, width - 320)}px`;
          tipEl.style.top = `${ev.clientY - rect.top + 14}px`;
        } else {
          tipEl.style.display = 'none';
        }
      }
    };
    const onLeave = (): void => {
      if (hovered) {
        hovered = null;
        draw();
      }
      if (tipEl) tipEl.style.display = 'none';
    };
    const onClick = (ev: MouseEvent): void => {
      const hit = pick(ev);
      if (hit) onSelectUrl(hit.url);
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);

    return () => {
      sim.stop();
      sel.on('.zoom', null);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
      if (tipEl) tipEl.style.display = 'none';
    };
  }, [data, mode, onSelectUrl]);

  // ---- Crawl tree (SVG; discovery hierarchy via first-discoverer) -----------
  useEffect(() => {
    if (mode !== 'tree') return;
    const svgEl = svgRef.current;
    if (!svgEl || !data) return;

    const height = svgEl.clientHeight || 600;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    if (data.nodes.length === 0) return;

    const root = svg.append('g');
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 8])
      .on('zoom', (ev) => root.attr('transform', ev.transform.toString()));
    svg.call(zoom);

    const ROOT = '__root__';
    const urlSet = new Set(data.nodes.map((n) => n.url));
    const strat = d3
      .stratify<GraphNode | { url: string; sourceUrl: null }>()
      .id((d) => d.url)
      .parentId((d) => {
        if (d.url === ROOT) return '';
        const src = (d as GraphNode).sourceUrl;
        return src && urlSet.has(src) && src !== d.url ? src : ROOT;
      });

    let hierarchyRoot: d3.HierarchyNode<GraphNode | { url: string; sourceUrl: null }>;
    try {
      hierarchyRoot = strat([{ url: ROOT, sourceUrl: null }, ...data.nodes]);
    } catch {
      // Fallback: cycle/multiple-root guard — attach everything under the root.
      const flat = [
        { url: ROOT, sourceUrl: null } as { url: string; sourceUrl: null },
        ...data.nodes.map((n) => ({ ...n, sourceUrl: null as null })),
      ];
      hierarchyRoot = d3
        .stratify<GraphNode | { url: string; sourceUrl: null }>()
        .id((d) => d.url)
        .parentId((d) => (d.url === ROOT ? '' : ROOT))(flat);
    }

    const rowH = 16;
    const layout = d3.tree<GraphNode | { url: string; sourceUrl: null }>().nodeSize([rowH, 220]);
    layout(hierarchyRoot);

    const link = root
      .append('g')
      .attr('fill', 'none')
      .attr('stroke', '#334155')
      .attr('stroke-opacity', 0.6);
    const nodeG = root.append('g');

    // d3.tree with nodeSize places the root at 0,0; x is vertical, y is horizontal.
    link
      .selectAll('path')
      .data(hierarchyRoot.links().filter((l) => l.source.data.url !== ROOT))
      .join('path')
      .attr('stroke-width', 0.7)
      .attr(
        'd',
        d3
          .linkHorizontal<d3.HierarchyPointLink<GraphNode | { url: string; sourceUrl: null }>, d3.HierarchyPointNode<GraphNode | { url: string; sourceUrl: null }>>()
          .x((d) => d.y)
          .y((d) => d.x) as never
      );

    const visible = hierarchyRoot.descendants().filter((d) => d.data.url !== ROOT) as d3.HierarchyPointNode<GraphNode>[];
    const g = nodeG
      .selectAll<SVGGElement, d3.HierarchyPointNode<GraphNode>>('g')
      .data(visible)
      .join('g')
      .attr('transform', (d) => `translate(${d.y},${d.x})`)
      .style('cursor', 'pointer')
      .on('click', (_e, d) => onSelectUrl(d.data.url));

    g.append('circle')
      .attr('r', 3.5)
      .attr('fill', (d) => statusColor(d.data.status))
      .attr('fill-opacity', (d) => (d.data.indexable === 1 ? 1 : 0.4))
      .each(function (d) {
        d3.select(this)
          .append('title')
          .text(`${d.data.url}\nstatus ${d.data.status ?? '—'} · depth ${d.data.depth ?? '—'} · in ${d.data.inlinks} · out ${d.data.outlinks}`);
      });

    g.append('text')
      .attr('dx', 6)
      .attr('dy', 3)
      .attr('font-size', 10)
      .attr('fill', '#cbd5e1')
      .text((d) => (d.data.path.length > 46 ? d.data.path.slice(0, 45) + '…' : d.data.path));

    // Fit the tree into view.
    const xs = visible.map((d) => d.x);
    const minX = Math.min(0, ...xs);
    const maxX = Math.max(0, ...xs);
    const treeH = maxX - minX + rowH * 2;
    const scale = Math.max(0.05, Math.min(1, (height - 20) / treeH));
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(20, height / 2 - ((minX + maxX) / 2) * scale).scale(scale)
    );
  }, [data, mode, onSelectUrl]);

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-800 text-sm">
        <div className="flex rounded overflow-hidden border border-slate-700">
          {(['force', 'tree'] as Mode[]).map((m) => (
            <button
              key={m}
              className={
                'px-3 py-1 cursor-pointer ' +
                (mode === m ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
              }
              onClick={() => setMode(m)}
            >
              {m === 'force' ? 'Force graph' : 'Crawl tree'}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-slate-400">
            {data.nodes.length.toLocaleString()} nodes · {data.edges.length.toLocaleString()} links
            {data.truncated && <span className="text-amber-400"> (capped for performance)</span>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <Legend color="#10b981" label="2xx" />
          <Legend color="#38bdf8" label="3xx" />
          <Legend color="#f59e0b" label="4xx" />
          <Legend color="#ef4444" label="5xx" />
          <span className="text-slate-500">scroll to zoom · hover to focus · click a node</span>
        </span>
      </div>
      <div className="flex-1 min-h-0 relative">
        {loading && <Centered>Building graph…</Centered>}
        {error && <Centered>Failed to load graph: {error}</Centered>}
        {!loading && !error && data && data.nodes.length === 0 && (
          <Centered>No crawl data yet — run a crawl to see the site architecture.</Centered>
        )}
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          style={{ display: mode === 'force' ? 'block' : 'none' }}
        />
        <svg
          ref={svgRef}
          className="w-full h-full block"
          style={{ display: mode === 'tree' ? 'block' : 'none' }}
        />
        <div
          ref={tipRef}
          className="absolute z-20 max-w-md px-2 py-1 rounded bg-slate-800/95 border border-slate-600 text-xs text-slate-200 pointer-events-none"
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm pointer-events-none z-10">
      {children}
    </div>
  );
}
