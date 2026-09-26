/**
 * Pure-logic slot assignment: matches light-DOM children against
 * the slots declared by a shadow template. Used to detect and repair
 * slot misalignment (插槽错位) before/after activation.
 */

/**
 * @param {Array<{slot?: string|null}>} lightChildren  light-DOM children descriptors
 * @param {string[]} templateSlots  slot names declared in the template ('' = default slot)
 * @returns {{assignments: Array<{child: number, slot: string, repaired: boolean}>,
 *            mismatches: string[]}}
 */
export function computeSlotAssignments(lightChildren, templateSlots) {
  const assignments = [];
  const mismatches = [];
  const declared = new Set(templateSlots);
  const hasDefault = declared.has('');

  lightChildren.forEach((child, index) => {
    const requested = child.slot ?? '';
    if (requested === '') {
      if (hasDefault || templateSlots.length === 0) {
        assignments.push({ child: index, slot: '', repaired: false });
      } else {
        mismatches.push(`第 ${index + 1} 个 Light DOM 子节点无 slot 属性，但模板没有默认插槽`);
        assignments.push({ child: index, slot: templateSlots[0], repaired: true });
      }
      return;
    }
    if (declared.has(requested)) {
      assignments.push({ child: index, slot: requested, repaired: false });
    } else {
      mismatches.push(`Light DOM 请求了模板中不存在的插槽 "${requested}"`);
      assignments.push({ child: index, slot: hasDefault ? '' : templateSlots[0] ?? '', repaired: true });
    }
  });

  return { assignments, mismatches };
}
