import type { AvatarFinish } from '@morrowbot/contracts';
import type { AvatarFrame, EyeMark, FramePath, FrameShape, Matrix } from 'open-bot-avatar';
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Stop, type PathProps } from 'react-native-svg';
import { finishLook, FUR_STROKE, type Sheen } from './finish.ts';
import { bodyBox } from './frame.ts';

type Slice = Extract<FrameShape, { kind: 'slice' }>;

/** The frame's shapes in drawing order, with each unbroken run of body cross-sections kept together. */
type Layer = { readonly kind: 'body'; readonly slices: readonly Slice[] } | { readonly kind: 'other'; readonly shape: Exclude<FrameShape, Slice> };

function layersOf(shapes: readonly FrameShape[]): Layer[] {
  const layers: Layer[] = [];
  for (const shape of shapes) {
    const last = layers.at(-1);
    if (shape.kind !== 'slice') layers.push({ kind: 'other', shape });
    else if (last?.kind === 'body') layers[layers.length - 1] = { kind: 'body', slices: [...last.slices, shape] };
    else layers.push({ kind: 'body', slices: [shape] });
  }
  return layers;
}

/** A rectangle as a path: react-native-svg's `Rect` shares its `x` and `y` with a deprecated transform shorthand. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.min(r, w / 2, h / 2);
  const arc = (dx: number, dy: number) => `a${String(k)} ${String(k)} 0 0 1 ${String(dx)} ${String(dy)}`;
  return `M${String(x + k)} ${String(y)}h${String(w - 2 * k)}${arc(k, k)}v${String(h - 2 * k)}${arc(-k, k)}h${String(2 * k - w)}${arc(-k, -k)}v${String(2 * k - h)}${arc(k, -k)}Z`;
}

type Box = NonNullable<ReturnType<typeof bodyBox>>;

/** The matrix that undoes `m`, or null for a slice seen edge-on. */
function inverse(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-6) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const sheenId = (slice: Slice, sheen: Sheen): string => `${slice.key}-${sheen.id}`;

/**
 * A finish's light laid over the whole body's box, for one cross-section. A gradient is placed in the coordinates
 * of the path that uses it, after that path's own transform, so `undo` takes it back to where the body's box is.
 */
function SheenGradient(props: { readonly id: string; readonly sheen: Sheen; readonly box: Box; readonly undo: Matrix }) {
  const { sheen, box } = props;
  const x = (share: number): number => box.x + share * box.w;
  const y = (share: number): number => box.y + share * box.h;
  const stops = sheen.stops.map((stop) => <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />);
  return sheen.kind === 'radial' ? (
    <RadialGradient id={props.id} gradientUnits="userSpaceOnUse" gradientTransform={props.undo} cx={x(sheen.cx)} cy={y(sheen.cy)} r={sheen.r * Math.max(box.w, box.h)}>
      {stops}
    </RadialGradient>
  ) : (
    <LinearGradient id={props.id} gradientUnits="userSpaceOnUse" gradientTransform={props.undo} x1={x(sheen.x1)} y1={y(sheen.y1)} x2={x(sheen.x2)} y2={y(sheen.y2)}>
      {stops}
    </LinearGradient>
  );
}

/** The part a slice belongs to: one stack of a body part (`0z12` is in `0z`), or a mark on its own. */
const partOf = (key: string): string => /^(\d+\D+)\d+$/u.exec(key)?.[1] ?? key;

/** For a furry finish, the largest cross-section of each part: its outline is where the tufts show. */
function furredSlices(slices: readonly Slice[], paths: ReadonlyMap<string, FramePath>): ReadonlySet<string> {
  const largest = new Map<string, { readonly key: string; readonly area: number }>();
  for (const slice of slices) {
    const box = paths.get(slice.path)?.box;
    if (box === undefined) continue;
    const [a, b, c, d] = slice.matrix;
    const area = box.w * box.h * Math.abs(a * d - b * c);
    const part = partOf(slice.key);
    const was = largest.get(part);
    if (was === undefined || area > was.area) largest.set(part, { key: slice.key, area });
  }
  return new Set([...largest.values()].map(({ key }) => key));
}

function Eye(props: { readonly mark: EyeMark; readonly ink: string }) {
  const { mark, ink } = props;
  switch (mark.shape) {
    case 'pill':
      return <Path d={roundedRect(mark.x, mark.y, mark.width, mark.height, mark.radius)} fill={ink} />;
    case 'arc':
      return <Path d={mark.d} fill="none" stroke={ink} strokeWidth={mark.strokeWidth} strokeLinecap="round" />;
    case 'path':
      return <Path d={mark.d} fill={ink} />;
  }
}

function Other(props: { readonly shape: Exclude<FrameShape, Slice>; readonly ink: string }) {
  const { shape } = props;
  switch (shape.kind) {
    case 'eye':
      return (
        <G transform={shape.matrix}>
          <Eye mark={shape.mark} ink={props.ink} />
        </G>
      );
    case 'ribbon': {
      const id = shape.key;
      const { gradient } = shape;
      const last = Math.max(1, gradient.stops.length - 1);
      return (
        <G transform={shape.matrix}>
          <Defs>
            <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1={gradient.x1} y1={gradient.y1} x2={gradient.x2} y2={gradient.y2}>
              {gradient.stops.map((color, at) => <Stop key={at} offset={at / last} stopColor={color} />)}
            </LinearGradient>
          </Defs>
          <Path d={shape.d} fill={`url(#${id})`} />
        </G>
      );
    }
  }
}

function Body(props: {
  readonly slices: readonly Slice[];
  readonly paths: ReadonlyMap<string, FramePath>;
  readonly color: string;
  readonly sheens: readonly Sheen[];
  readonly lit: ReadonlySet<string>;
  readonly furred: ReadonlySet<string>;
}) {
  return props.slices.flatMap((slice) => {
    const path = props.paths.get(slice.path);
    if (path === undefined) return [];
    const rule: 'evenodd' | 'nonzero' = path.evenOdd ? 'evenodd' : 'nonzero';
    const fur = (paint: string): PathProps =>
      props.furred.has(slice.key) ? { stroke: paint, strokeWidth: FUR_STROKE.width, strokeDasharray: FUR_STROKE.dash, strokeLinecap: 'round' } : {};
    const lights = props.lit.has(slice.key) ? props.sheens : [];
    return [
      <Path key={slice.key} d={path.d} fillRule={rule} transform={slice.matrix} fill={props.color} {...fur(props.color)} />,
      ...lights.map((sheen) => {
        const id = sheenId(slice, sheen);
        return <Path key={id} d={path.d} fillRule={rule} transform={slice.matrix} fill={`url(#${id})`} {...fur(`url(#${id})`)} />;
      }),
    ];
  });
}

const layerKey = (layer: Layer): string => (layer.kind === 'body' ? layer.slices[0]?.key ?? 'body' : layer.shape.key);

/** One avatar frame drawn with react-native-svg, `size` points square over `viewBox`. */
export function FrameSvg(props: { readonly frame: AvatarFrame; readonly finish: AvatarFinish; readonly size: number; readonly viewBox: string }) {
  const { frame } = props;
  const look = finishLook(props.finish);
  const paths = new Map(frame.paths.map((path) => [path.id, path]));
  const slices = frame.shapes.filter((shape): shape is Slice => shape.kind === 'slice');
  const box = bodyBox(frame);
  const sheens = box === null ? [] : look.sheens;
  const undone = sheens.length === 0 ? [] : slices.flatMap((slice) => {
    const undo = inverse(slice.matrix);
    return undo === null ? [] : [{ slice, undo }];
  });
  const lit = new Set(undone.map(({ slice }) => slice.key));
  const furred = look.fur ? furredSlices(slices, paths) : new Set<string>();
  return (
    <Svg width={props.size} height={props.size} viewBox={props.viewBox}>
      <Defs>
        {box === null
          ? null
          : undone.flatMap(({ slice, undo }) => sheens.map((sheen) => <SheenGradient key={sheenId(slice, sheen)} id={sheenId(slice, sheen)} sheen={sheen} box={box} undo={undo} />))}
      </Defs>
      <G transform={frame.root}>
        {layersOf(frame.shapes).map((layer) =>
          layer.kind === 'body' ? (
            <Body key={layerKey(layer)} slices={layer.slices} paths={paths} color={frame.color} sheens={sheens} lit={lit} furred={furred} />
          ) : (
            <Other key={layerKey(layer)} shape={layer.shape} ink={frame.ink} />
          ),
        )}
      </G>
    </Svg>
  );
}
