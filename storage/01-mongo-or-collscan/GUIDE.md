# 주말 실습 이어하기 가이드

## 0. 오늘(2026-11-11)까지 확인한 것
1. `mongo:5.0` 컨테이너(`mongo-or-lab`)에 10만 건 데이터와 3개 인덱스(`id`, `ids.store+item+color+size`, `ids.item+color+size`) 적재 완료
2. 단 한 갈래라도 인덱스 없는 조건(`key_object.*`)이 `$or`에 섞이면, MongoDB가 `IXSCAN`을 포기하고 통째로 `COLLSCAN`을 선택함을 `explain('queryPlanner')`로 확인 완료

## 1. 주말 시작 전 준비 (1분)
VS Code에서 `/Users/iyonghwa/effort/storage/01-mongo-or-collscan` 폴더를 열고 터미널에서 컨테이너가 떠 있는지 확인합니다.

```bash
docker ps --filter name=mongo-or-lab
# 만약 안 떠 있다면:
docker compose up -d
```

그리고 `queryBuilder.js`가 비어 있다면 아래 장애 재현용 레거시 함수만 먼저 복사해서 넣어둡니다.

```js
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
  throw new Error('buildSafeOrQuery 함수를 직접 구현해 주세요.');
}
```

## 2. 주말에 하나씩 구현할 순서 (한 번에 한 함수만!)

### Step 1. `verify.js`의 `hasCollscan(planNode)` 작성
- 처음부터 완벽한 재귀를 짜려고 하지 말고, 먼저 함수 첫 줄에 `console.log(JSON.stringify(planNode, null, 2));`를 찍어서 `npm run verify`를 한 번 돌려보세요.
- 출력된 JSON이 어떻게 생겼는지 눈으로 확인한 뒤, 그 트리 안에서 `'COLLSCAN'`이 있으면 `true`를 반환하게 짜면 됩니다.
- 이 함수를 완성하고 `npm run verify`를 실행하면 `[1] 기존 방식`의 15개 조합 결과(9개 `COLLSCAN`)가 화면에 뜹니다.

### Step 2. `queryBuilder.js`의 `buildSafeOrQuery(rows)` 1차 작성 (거절 조건 없이!)
- 처음부터 어떤 조합을 거절할지 머리로 다 계산하지 마세요.
- 일단 들어온 `rows`의 각 행에서 채워진 칸(`store`, `item`, `color`, `size`)을 전부 `ids.*` 필드(`ids.store`, `ids.item`, ...)로 옮겨 `{ $or: [...] }`를 반환하게만 먼저 짜세요.

### Step 3. `verify.js`의 `verifySafeQueries(collection, combinations)` 작성 및 검증 완성
- `combinations`를 돌면서 `buildSafeOrQuery([item.row])`의 `explain` 결과를 찍어보고, 통과한 행들을 모아 한꺼번에 `$or`로 묶었을 때도 `COLLSCAN`이 없는지 검사하는 테스트를 작성합니다.
- 이 상태에서 `npm run verify`를 실행하면 **15조합 중 어떤 조합이 실제로 `COLLSCAN`으로 떨어지는지** 눈으로 직접 보입니다.
- 그 실패한 조합들을 보고 *"왜 복합 인덱스 2개로는 얘네를 못 탈까?"*를 확인한 뒤, `buildSafeOrQuery`에 거절 조건(`throw new Error(...)`)을 추가해 최종 통과를 띄우면 끝입니다!
