import type { AvatarFinish } from '@morrowbot/contracts';
import type { AvatarFrame, EyeMark, FramePath, FrameShape } from 'open-bot-avatar';
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

/** A finish's light laid over the whole body's box, so every cross-section is lit alike wherever it sits. */
function SheenGradient(props: { readonly sheen: Sheen; readonly box: Box }) {
  const { sheen, box } = props;
  const x = (share: number): number => box.x + share * box.w;
  const y = (share: number): number => box.y + share * box.h;
  const stops = sheen.stops.map((stop) => <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />);
  return sheen.kind === 'radial' ? (
    <RadialGradient id={sheen.id} gradientUnits="userSpaceOnUse" cx={x(sheen.cx)} cy={y(sheen.cy)} r={sheen.r * Math.max(box.w, box.h)}>
      {stops}
    </RadialGradient>
  ) : (
    <LinearGradient id={sheen.id} gradientUnits="userSpaceOnUse" x1={x(sheen.x1)} y1={y(sheen.y1)} x2={x(sheen.x2)} y2={y(sheen.y2)}>
      {stops}
    </LinearGradient>
  );
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

function Other(props: { readonly shape: Exclude<FrameShape, Slice>; readonly index: number; readonly ink: string }) {
  const { shape } = props;
  switch (shape.kind) {
    case 'eye':
      return (
        <G transform={shape.matrix}>
          <Eye mark={shape.mark} ink={props.ink} />
        </G>
      );
    case 'ribbon': {
      const id = `ribbon${String(props.index)}`;
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
  readonly fur: boolean;
}) {
  const front = props.slices.length - 1;
  const fur = (at: number, paint: string): PathProps =>
    props.fur && at === front ? { stroke: paint, strokeWidth: FUR_STROKE.width, strokeDasharray: FUR_STROKE.dash, strokeLinecap: 'round' } : {};
  return props.slices.flatMap((slice, at) => {
    const path = props.paths.get(slice.path);
    if (path === undefined) return [];
    const rule: 'evenodd' | 'nonzero' = path.evenOdd ? 'evenodd' : 'nonzero';
    const key = `${slice.key}-${String(at)}`;
    return [
      <Path key={key} d={path.d} fillRule={rule} transform={slice.matrix} fill={props.color} {...fur(at, props.color)} />,
      ...props.sheens.map((sheen) => {
        const light = `url(#${sheen.id})`;
        return <Path key={`${key}-${sheen.id}`} d={path.d} fillRule={rule} transform={slice.matrix} fill={light} {...fur(at, light)} />;
      }),
    ];
  });
}

/** One avatar frame drawn with react-native-svg, `size` points square over `viewBox`. */
export function FrameSvg(props: { readonly frame: AvatarFrame; readonly finish: AvatarFinish; readonly size: number; readonly viewBox: string }) {
  const { frame } = props;
  const look = finishLook(props.finish);
  const paths = new Map(frame.paths.map((path) => [path.id, path]));
  const box = bodyBox(frame);
  const sheens = box === null ? [] : look.sheens;
  return (
    <Svg width={props.size} height={props.size} viewBox={props.viewBox}>
      <Defs>{box === null ? null : sheens.map((sheen) => <SheenGradient key={sheen.id} sheen={sheen} box={box} />)}</Defs>
      <G transform={frame.root}>
        {layersOf(frame.shapes).map((layer, index) =>
          layer.kind === 'body' ? (
            <Body key={index} slices={layer.slices} paths={paths} color={frame.color} sheens={sheens} fur={look.fur} />
          ) : (
            <Other key={index} shape={layer.shape} index={index} ink={frame.ink} />
          ),
        )}
      </G>
    </Svg>
  );
}
