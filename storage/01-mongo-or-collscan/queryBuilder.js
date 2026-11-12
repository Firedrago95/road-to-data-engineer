function formatCode(prefix, num, pad) {
  return `${prefix}${String(num).padStart(pad, '0')}`;
}

export function buildLegacyOrQuery(rows) {
  const conditions = rows.map((row) => {
    const hasStore = row.store !== undefined;
    const hasItem = row.item !== undefined;
    const hasColor = row.color !== undefined;
    const hasSize = row.size !== undefined;

    if (hasStore && hasItem && hasColor && hasSize) {
      return {
        id: [
          formatCode('S', row.store, 3),
          formatCode('I', row.item, 4),
          formatCode('C', row.color, 2),
          formatCode('Z', row.size, 2),
        ].join('_'),
      };
    }

    if (!hasSize && (hasStore || hasItem) && !(hasStore && !hasItem && hasColor)) {
      const cond = {};
      if (hasStore) cond['ids.store'] = row.store;
      if (hasItem) cond['ids.item'] = row.item;
      if (hasColor) cond['ids.color'] = row.color;
      return cond;
    }

    const fallbackCond = {};
    if (hasStore) fallbackCond['key_object.store'] = formatCode('S', row.store, 3);
    if (hasItem) fallbackCond['key_object.item'] = formatCode('I', row.item, 4);
    if (hasColor) fallbackCond['key_object.color'] = formatCode('C', row.color, 2);
    if (hasSize) fallbackCond['key_object.size'] = formatCode('Z', row.size, 2);
    return fallbackCond;
  });

  return { $or: conditions };
}

export function buildSafeOrQuery(rows) {
  const conditions = rows.map((row) => {
    const cond = {};
    if (row.store === undefined && row.item === undefined) {
      throw new Error("인덱스 못타는 조합입니다. store + item 조합");
    }
    if (row.store !== undefined) {
      cond['ids.store'] = row.store;
    }
    if (row.item !== undefined) {
      cond['ids.item'] = row.item;
    }
    if (row.color !== undefined) {
      cond['ids.color'] = row.color;
    }
    if (row.size !== undefined) {
      cond['ids.size'] = row.size
    }
    return cond;
  })

  return { $or: conditions };
}