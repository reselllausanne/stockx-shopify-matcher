const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDB() {
  try {
    console.log('🔍 Checking database contents...\n');

    // Check OrderMatch count
    const orderMatchCount = await prisma.orderMatch.count();
    console.log(`📦 OrderMatch records: ${orderMatchCount}`);

    // Check OrderMetric count
    const orderMetricCount = await prisma.orderMetric.count();
    console.log(`📊 OrderMetric records: ${orderMetricCount}`);

    if (orderMatchCount > 0) {
      console.log('\n📋 Sample OrderMatch records:');
      const samples = await prisma.orderMatch.findMany({
        take: 3,
        select: {
          shopifyOrderName: true,
          stockxOrderNumber: true,
          supplierCost: true,
          marginAmount: true,
          marginPercent: true,
          shopifyMetafieldsSynced: true,
        }
      });
      samples.forEach((match, i) => {
        console.log(`  ${i+1}. ${match.shopifyOrderName} ↔ ${match.stockxOrderNumber}`);
        console.log(`     Cost: CHF ${match.supplierCost}, Margin: CHF ${match.marginAmount} (${match.marginPercent}%)`);
        console.log(`     Metafields synced: ${match.shopifyMetafieldsSynced}`);
      });
    }

    if (orderMetricCount > 0) {
      console.log('\n📈 Sample OrderMetric records:');
      const samples = await prisma.orderMetric.findMany({
        take: 3,
        orderBy: { createdAt: 'desc' },
        select: {
          shopifyOrderId: true,
          createdAt: true,
          grossSales: true,
          marginChf: true,
          marginPct: true,
        }
      });
      samples.forEach((metric, i) => {
        console.log(`  ${i+1}. ${new Date(metric.createdAt).toLocaleDateString()}: CHF ${metric.grossSales} sales, CHF ${metric.marginChf} margin (${metric.marginPct}%)`);
      });
    }

    console.log('\n✅ Database check complete');

  } catch (error) {
    console.error('❌ Database error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkDB();
