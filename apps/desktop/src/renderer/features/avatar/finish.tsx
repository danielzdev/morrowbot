import type { AvatarFinish } from '@morrowbot/contracts';
import type { AvatarMaterial } from 'open-bot-avatar/dom';
import { fluffy } from 'open-bot-avatar/materials/fluffy';

/** The engine's material: fluffy is the engine's fur; flat, matte and metallic all paint flat, and the last two are lit by a filter. */
export function materialOf(finish: AvatarFinish): AvatarMaterial {
  switch (finish) {
    case 'fluffy':
      return fluffy;
    case 'flat':
    case 'matte':
    case 'metallic':
      return 'flat';
  }
}

export function hasFilter(finish: AvatarFinish): boolean {
  return finish === 'matte' || finish === 'metallic';
}

const REGION = { x: '-25%', y: '-25%', width: '150%', height: '150%' };

/**
 * Lights the flat body as a raised surface from its own outline: a blurred alpha is the height,
 * so shading follows any shape. Blur and relief scale with `size` (CSS pixels) to keep one look at
 * every size.
 */
export function FinishFilter(props: { readonly id: string; readonly finish: AvatarFinish; readonly size: number }) {
  const relief = Math.max(2, props.size * 0.09);
  switch (props.finish) {
    case 'flat':
    case 'fluffy':
      return null;
    case 'matte':
      return (
        <svg class="bot-avatar-defs" width="0" height="0" aria-hidden="true" focusable="false">
          <filter id={props.id} {...REGION} color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation={props.size * 0.08} result="height" />
            <feDiffuseLighting in="height" surfaceScale={relief} diffuseConstant="1.2" lighting-color="#ffffff" result="light">
              <feDistantLight azimuth="225" elevation="55" />
            </feDiffuseLighting>
            <feComposite in="SourceGraphic" in2="light" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="lit" />
            <feColorMatrix in="lit" type="saturate" values="0.8" result="soft" />
            <feComposite in="soft" in2="SourceAlpha" operator="in" />
          </filter>
        </svg>
      );
    case 'metallic':
      return (
        <svg class="bot-avatar-defs" width="0" height="0" aria-hidden="true" focusable="false">
          <filter id={props.id} {...REGION} color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation={props.size * 0.12} result="height" />
            <feDiffuseLighting in="height" surfaceScale={relief * 1.4} diffuseConstant="1" lighting-color="#ffffff" result="diffuse">
              <feDistantLight azimuth="225" elevation="35" />
            </feDiffuseLighting>
            <feComponentTransfer in="diffuse" result="bands">
              <feFuncR type="table" tableValues="0.3 1 0.5 0.9 1" />
              <feFuncG type="table" tableValues="0.3 1 0.5 0.9 1" />
              <feFuncB type="table" tableValues="0.3 1 0.5 0.9 1" />
            </feComponentTransfer>
            <feComposite in="SourceGraphic" in2="bands" operator="arithmetic" k1="1.3" k2="0" k3="0" k4="0" result="tinted" />
            <feSpecularLighting in="height" surfaceScale={relief * 1.4} specularConstant="1.1" specularExponent="22" lighting-color="#ffffff" result="spec">
              <feDistantLight azimuth="225" elevation="50" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="shine" />
            <feComposite in="tinted" in2="shine" operator="arithmetic" k1="0" k2="1" k3="0.9" k4="0" result="metal" />
            <feComposite in="metal" in2="SourceAlpha" operator="in" />
          </filter>
        </svg>
      );
  }
}
