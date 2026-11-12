import { MongoClient } from 'mongodb';

const MONGO_URL = 'mongodb://localhost:27017';
const DB_NAME = 'inventory_lab';
const COLLECTION_NAME = 'store_stocks';

function formatCode(prefix, num, pad) {
  return `${prefix}${String(num).padStart(pad, '0')}`;
}

function buildDocuments() {
  const docs = [];
  for (let store = 1; store <= 50; store += 1) {
    for (let item = 1; item <= 200; item += 1) {
      for (let color = 1; color <= 5; color += 1) {
        for (let size = 1; size <= 2; size += 1) {
          const storeCode = formatCode('S', store, 3);
          const itemCode = formatCode('I', item, 4);
          const colorCode = formatCode('C', color, 2);
          const sizeCode = formatCode('Z', size, 2);
          docs.push({
            id: `${storeCode}_${itemCode}_${colorCode}_${sizeCode}`,
            ids: { store, item, color, size },
            key_object: {
              store: storeCode,
              item: itemCode,
              color: colorCode,
              size: sizeCode,
            },
            stock: (store + item + color + size) % 100,
          });
        }
      }
    }
  }
  return docs;
}

async function seed() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    await collection.drop().catch(() => {});

    const docs = buildDocuments();
    const batchSize = 10000;
    for (let i = 0; i < docs.length; i += batchSize) {
      await collection.insertMany(docs.slice(i, i + batchSize));
    }

    await collection.createIndex({ id: 1 });
    await collection.createIndex({
      'ids.store': 1,
      'ids.item': 1,
      'ids.color': 1,
      'ids.size': 1,
    });
    await collection.createIndex({
      'ids.item': 1,
      'ids.color': 1,
      'ids.size': 1,
    });

    const count = await collection.countDocuments();
    const indexes = await collection.indexes();
    console.log(`더미 데이터 적재 완료: 총 ${count}건`);
    console.log('생성된 인덱스 목록:', indexes.map((idx) => idx.key));
  } finally {
    await client.close();
  }
}

seed().catch((err) => {
  console.error('데이터 적재 실패:', err);
  process.exit(1);
});
