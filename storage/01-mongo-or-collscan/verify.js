import { MongoClient } from 'mongodb';
import { buildLegacyOrQuery, buildSafeOrQuery } from './queryBuilder.js';

const MONGO_URL = 'mongodb://localhost:27017';
const DB_NAME = 'inventory_lab';
const COLLECTION_NAME = 'store_stocks';

function generateAll15Combinations() {
  const fields = ['store', 'item', 'color', 'size'];
  const combinations = [];

  for (let mask = 1; mask < 16; mask += 1) {
    const row = {};
    const activeFields = [];
    fields.forEach((field, idx) => {
      if ((mask & (1 << idx)) !== 0) {
        row[field] = 1;
        activeFields.push(field);
      }
    });
    combinations.push({
      label: activeFields.join('+'),
      row,
    });
  }
  return combinations;
}

async function getWinningPlan(collection, query) {
  const explained = await collection.find(query).explain('queryPlanner');
  return explained.queryPlanner.winningPlan;
}

function hasCollscan(planNode) {
  if (planNode === null || planNode === undefined) return false;
  if (planNode.stage === 'COLLSCAN') return true;

  if (Array.isArray(planNode.inputStages)) {
    return planNode.inputStages.some(i => hasCollscan(i));
  }
  return hasCollscan(planNode.inputStage);
}

async function verifyLegacyQueries(collection, combinations) {
  console.log('\n=== [1] 기존 방식(buildLegacyOrQuery) 15조합 확인 ===');
  for (const item of combinations) {
    const query = buildLegacyOrQuery([item.row]);
    const plan = await getWinningPlan(collection, query);
    const result = hasCollscan(plan) ? 'COLLSCAN' : 'IXSCAN';
    console.log(`- ${item.label.padEnd(22)} => ${result}`);
  }
}

async function verifySafeQueries(collection, combinations) {
  console.log('\n=== [2] 안전한 방식(buildSafeOrQuery 15조합 확인 ===');
  const acceptedRows = [];
  let collscanCount = 0;
  for (const item of combinations) {
    try {
      const query = buildSafeOrQuery([item.row]);
      const plan = await getWinningPlan(collection, query);
      const isCollscan = hasCollscan(plan);
      const result = isCollscan ? 'COLLSCAN' : 'IXSCAN';
      if (isCollscan) {
        collscanCount += 1;
      } else {
        acceptedRows.push(item.row);
      }
      console.log(`- ${item.label.padEnd(22)} => ${result}`);
    } catch (err) {
      console.log(`- ${item.label.padEnd(22)} => 거절됨 (${err.message})`);
    }
  }
  
  if (acceptedRows.length > 0) {
    const query = buildSafeOrQuery(acceptedRows);
    const plan = await getWinningPlan(collection, query);
    const isCollscan = hasCollscan(plan);
    console.log(`\n통과된 ${acceptedRows.length}개 행을 하나의 $or로 묶은 결과 => ${isCollscan ? 'COLLSCAN' : 'IXSCAN'}`);
    if (isCollscan) {
      collscanCount += 1;
    }
  }
  if (collscanCount > 0 || acceptedRows.length === 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const client = new MongoClient(MONGO_URL);
  const combinations = generateAll15Combinations();

  try {
    await client.connect();
    const collection = client.db(DB_NAME).collection(COLLECTION_NAME);

    await verifyLegacyQueries(collection, combinations);
    await verifySafeQueries(collection, combinations);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('실행 오류:', err.message);
  process.exit(1);
});
