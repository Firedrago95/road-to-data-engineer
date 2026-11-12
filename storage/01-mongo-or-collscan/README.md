# 01. MongoDB `$or` 전체 스캔 원인과 복합 인덱스 조건 설계

- 일시: 2026-11-11 ~ 2026-11-12
- 목표: 다중 속성 조건을 `$or`로 조회할 때 단 한 갈래만 인덱스가 없어도 전체 스캔(`COLLSCAN`)이 발생하는 원인을 규명하고, 15가지 입력 조합이 모두 인덱스를 타도록 조건 생성 로직과 자동 검증 테스트 구현

## 1. 실험 전 예측 (사용자 사전 작성)

1. `A OR B` 조건이라면 둘 중 하나만 만족해도 되니, A에 인덱스가 있고 B에 없더라도 A만이라도 인덱스를 타는 게 효율적인 것 아닌가?
2. 복합 인덱스 `(ids.store, ids.item, ids.color, ids.size)`와 `(ids.item, ids.color, ids.size)`가 있을 때, 15가지 조합 중 `(color, size)`, `(item, color, size)`, `(size)`, `(color)`, `(item)` 5가지가 인덱스를 못 탈 것 같다. (일부만 있거나 뒤에 있는 조합이라서)

## 2. 실험 환경

- 실행 환경: Docker `mongo:5.0` (`mongo-or-lab`, 포트 27017) + Node.js v22 (`mongodb` 드라이버)
- 데이터 구성 (`seed.js`): `inventory_lab.store_stocks` 컬렉션에 매장(50) × 품번(200) × 컬러(5) × 사이즈(2) = **100,000건** 적재
- 문서 구조: 한 문서 안에 용도별로 3가지 키 표현을 함께 저장
  - `id`: `"S001_I0001_C01_Z01"` (조합 문자열)
  - `ids`: `{ store: 1, item: 1, color: 1, size: 1 }` (숫자 ID 객체)
  - `key_object`: `{ store: "S001", item: "I0001", color: "C01", size: "Z01" }` (화면/코드 문자열 객체)
- 인덱스 구성:
  - `{ id: 1 }`
  - `{ "ids.store": 1, "ids.item": 1, "ids.color": 1, "ids.size": 1 }`
  - `{ "ids.item": 1, "ids.color": 1, "ids.size": 1 }`
  - `key_object.*` 필드에는 인덱스 없음

## 3. 실험 및 실측 결과

### 실험 1: `$or` 갈래 중 한쪽만 인덱스가 없을 때 실행 계획 비교
`explain('queryPlanner')`로 두 갈래 모두 인덱스가 있는 `$or`와, 한 갈래만 인덱스 없는 `key_object.*`가 섞인 `$or`를 비교합니다.

```text
# 1) 모든 갈래에 인덱스가 있는 $or: { id: 'S001_I0001_C01_Z01' } OR { 'ids.store': 1, 'ids.item': 1 }
winningPlan: SUBPLAN -> FETCH -> OR -> [ IXSCAN (ids.store_1_ids.item_1_ids.color_1_ids.size_1), IXSCAN (id_1) ]

# 2) 한 갈래만 인덱스가 없는 $or: { id: 'S001_I0001_C01_Z01' } OR { 'key_object.store': 'S001', 'key_object.item': 'I0001' }
winningPlan: SUBPLAN -> COLLSCAN
```
- 실측: 인덱스 없는 조건이 단 한 갈래만 섞여도 `OR` 스테이지가 사라지고 조회 전체가 `COLLSCAN`으로 전환됨.

### 실험 2: 기존 레거시 분기(`buildLegacyOrQuery`)의 15조합 검증
입력 조합에 따라 `id`, `ids.*`, `key_object.*`를 섞어 쓰도록 구현한 `buildLegacyOrQuery`를 15가지 조합으로 실행 계획 검사(`verify.js`)한 결과입니다.

```text
=== [1] 기존 방식(buildLegacyOrQuery) 15조합 확인 ===
- store                  => IXSCAN
- item                   => IXSCAN
- store+item             => IXSCAN
- color                  => COLLSCAN
- store+color            => COLLSCAN
- item+color             => IXSCAN
- store+item+color       => IXSCAN
- size                   => COLLSCAN
- store+size             => COLLSCAN
- item+size              => COLLSCAN
- store+item+size        => COLLSCAN
- color+size             => COLLSCAN
- store+color+size       => COLLSCAN
- item+color+size        => COLLSCAN
- store+item+color+size  => IXSCAN
```
- 실측: `key_object.*` 분기로 빠진 **9가지 조합이 모두 `COLLSCAN`**으로 떨어짐. 정상 조합과 함께 `$or`로 묶이는 순간 전체 스캔이 발생함.

### 실험 3: `ids.*` 통일 및 불가능 조합 거절(`buildSafeOrQuery`) 검증
모든 입력 필드를 인덱스가 있는 `ids.*`의 같음(`=`) 비교로 통일하고, 15조합을 먼저 거절 없이 실행해 본 결과 `color`, `size`, `color+size` 딱 3가지 조합만 `COLLSCAN`이 발생했습니다. (`item`과 `item+color+size`는 인덱스 2의 선두 컬럼인 `ids.item`이 포함되어 `IXSCAN`으로 동작함.)

이후 `store`와 `item`이 모두 없는 경우 조회 전 예외로 거절하도록 수정하고 `npm run verify`를 실행한 최종 결과입니다.

```text
=== [2] 안전한 방식(buildSafeOrQuery 15조합 확인 ===
- store                  => IXSCAN
- item                   => IXSCAN
- store+item             => IXSCAN
- color                  => 거절됨 (인덱스 못타는 조합입니다. store + item 조합)
- store+color            => IXSCAN
- item+color             => IXSCAN
- store+item+color       => IXSCAN
- size                   => 거절됨 (인덱스 못타는 조합입니다. store + item 조합)
- store+size             => IXSCAN
- item+size              => IXSCAN
- store+item+size        => IXSCAN
- color+size             => 거절됨 (인덱스 못타는 조합입니다. store + item 조합)
- store+color+size       => IXSCAN
- item+color+size        => IXSCAN
- store+item+color+size  => IXSCAN

통과된 12개 행을 하나의 $or로 묶은 결과 => IXSCAN
```
- 실측: 3개 조합을 입구에서 거절하고 허용된 12개 조합을 하나의 `$or`로 묶어 실행했을 때도 `COLLSCAN` 0건(`IXSCAN`)으로 통과함.

## 4. 원인 분석

### 1. 한 갈래만 인덱스가 없어도 전체가 `COLLSCAN`이 되는 이유
`A OR B`에서 B 조건에 쓸 수 있는 인덱스가 없다면, B를 만족하는 문서를 찾기 위해 어차피 컬렉션의 모든 문서를 처음부터 끝까지 읽어야(`COLLSCAN`) 합니다. 어차피 전체 문서를 한 번 다 훑는 김에 A 조건까지 같이 검사해 버리는 것이, A 인덱스를 따로 읽고 중복 제거를 한 뒤 또 전체 문서를 읽는 것보다 비용이 적기 때문에 옵티마이저가 `OR` 계획을 버리고 `COLLSCAN`을 선택합니다.

### 2. 복합 인덱스 선두 컬럼 규칙과 조건 통일
복합 인덱스는 인덱스 정의의 맨 앞 컬럼(`ids.store` 또는 `ids.item`)부터 순서대로 탐색 범위를 좁혀갑니다. 따라서 중간 컬럼(`item`, `color`)이 비더라도 맨 앞 컬럼이 조건에 포함되어 있으면 인덱스를 탈 수 있지만, 두 인덱스의 선두 컬럼(`store`, `item`)이 모두 빠진 `color`, `size`, `color+size` 조합은 어떤 복합 인덱스도 시작 위치를 잡을 수 없습니다.

## 5. 결론 및 한계점 (사용자 작성)

1. `OR` 조건을 연결할 때는 두 조건 모두(모든 갈래) 인덱스를 타는지 살펴야 한다. 복합 인덱스는 맨 앞 컬럼이 포함되어 있어야 인덱스를 타며, 맨 앞 컬럼이 없는 조합끼리는 인덱스를 타지 못한다.
2. 조건 필드는 인덱스가 걸린 필드(`ids.*`)만 사용하도록 통일하고, 복합 인덱스의 맨 앞 컬럼이 없는 조합은 조회 전에 미리 차단한다. (비즈니스상 반드시 필요한 조회라면 차단 대신 해당 컬럼 조합에 맞는 인덱스를 DB에 추가해야 한다.)
3. 이 실험에서는 NoSQL(MongoDB)이 한 문서 안의 중첩 필드(`ids.*`) 일부만 골라 B-Tree 인덱스를 어떻게 저장하고 탐색하는지 내부 구조까지는 확인하지 못했다.
