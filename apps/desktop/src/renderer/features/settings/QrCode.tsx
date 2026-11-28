import { encode } from 'uqr';

/** Light modules around the code that scanners need to find its edges. */
const QUIET_ZONE = 4;

/** The dark modules of a QR code as one SVG path, one unit per module. */
export function qrPath(text: string): { readonly size: number; readonly path: string } {
  const { size, data } = encode(text, { ecc: 'M', border: 0 });
  const path = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${String(x)} ${String(y)}h1v1h-1z`] : []))).join('');
  return { size, path };
}

/** A scannable QR code: dark on light in both themes, with its quiet zone. */
export function QrCode(props: { readonly text: string; readonly label: string; readonly faded: boolean }) {
  const { size, path } = qrPath(props.text);
  const side = size + 2 * QUIET_ZONE;
  return (
    <svg
      class={props.faded ? 'qr-code faded' : 'qr-code'}
      viewBox={`${String(-QUIET_ZONE)} ${String(-QUIET_ZONE)} ${String(side)} ${String(side)}`}
      role="img"
      aria-label={props.label}
      shape-rendering="crispEdges"
    >
      <rect class="qr-paper" x={-QUIET_ZONE} y={-QUIET_ZONE} width={side} height={side} />
      <path class="qr-ink" d={path} />
    </svg>
  );
}
