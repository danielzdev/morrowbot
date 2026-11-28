/** The first letter of a name, as an extension's mark. */
export function ItemMark({ name }: { readonly name: string }) {
  return (
    <span class="item-mark" aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
