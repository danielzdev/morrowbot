import { memo } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { parseInline, parseMarkdown, type Block, type Inline } from './markdown.ts';

/** What rendered Markdown may do: links open in the system browser; code Copy goes to the clipboard. */
export interface MarkdownActions {
  readonly openLink: (href: string) => void;
  readonly copy: (text: string) => void;
}

function InlineNodes(props: { readonly nodes: readonly Inline[]; readonly actions: MarkdownActions }) {
  return (
    <>
      {props.nodes.map((node, index) => {
        switch (node.kind) {
          case 'text':
            return node.text;
          case 'code':
            return <code key={index}>{node.text}</code>;
          case 'strong':
            return <strong key={index}><InlineNodes nodes={node.children} actions={props.actions} /></strong>;
          case 'em':
            return <em key={index}><InlineNodes nodes={node.children} actions={props.actions} /></em>;
          case 'break':
            return <br key={index} />;
          case 'link':
            return (
              <a
                key={index}
                href={node.href}
                title={node.href}
                rel="noreferrer noopener"
                onClick={(event) => {
                  event.preventDefault();
                  props.actions.openLink(node.href);
                }}
              >
                <InlineNodes nodes={node.children} actions={props.actions} />
              </a>
            );
        }
      })}
    </>
  );
}

function CodeBlock(props: { readonly lang: string | null; readonly text: string; readonly actions: MarkdownActions }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  return (
    <div class="md-code">
      <div class="md-code-head" data-find-skip="">
        <span>{props.lang ?? 'text'}</span>
        <button
          class="ghost"
          aria-label={props.lang === null ? 'Copy code' : `Copy ${props.lang} code`}
          onClick={() => {
            props.actions.copy(props.text);
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => { setCopied(false); }, 1_500);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{props.text}</code></pre>
    </div>
  );
}

function Blocks(props: { readonly blocks: readonly Block[]; readonly actions: MarkdownActions }) {
  return (
    <>
      {props.blocks.map((block, index) => {
        switch (block.kind) {
          case 'paragraph':
            return <p key={index}><InlineNodes nodes={block.inlines} actions={props.actions} /></p>;
          case 'heading':
            return (
              <p key={index} class={`md-heading level-${String(block.level)}`} role="heading" aria-level={block.level}>
                <InlineNodes nodes={block.inlines} actions={props.actions} />
              </p>
            );
          case 'code':
            return <CodeBlock key={index} lang={block.lang} text={block.text} actions={props.actions} />;
          case 'list': {
            const items = block.items.map((item, at) => <li key={at}><Blocks blocks={item} actions={props.actions} /></li>);
            return block.ordered ? <ol key={index} start={block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
          }
        }
      })}
    </>
  );
}

/** A reply as safe Markdown. Parsed once per text; history re-renders only when its text changes. */
export const Markdown = memo(function Markdown(props: { readonly text: string; readonly actions: MarkdownActions }) {
  const blocks = useMemo(() => parseMarkdown(props.text), [props.text]);
  return <div class="md" data-find-text=""><Blocks blocks={blocks} actions={props.actions} /></div>;
});

/** One line of inline Markdown with no links, such as an approval title with `code` beside its buttons. */
export function InlineMarkdown(props: { readonly text: string; readonly actions: MarkdownActions }) {
  return <InlineNodes nodes={parseInline(props.text, true)} actions={props.actions} />;
}
