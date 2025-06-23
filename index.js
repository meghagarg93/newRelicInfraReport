const axios = require("axios");
const fetch = require('node-fetch');
const generateChart = require('./chartGenerator.js');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const dotenv = require("dotenv");
const sendEmail = require("./notify.js");
const { postToBasecamp, checkAndUpdateExpiresIn } = require('./basecamp.js');


dotenv.config(); // Load environment variables from .env

const API_KEY = process.env.API_KEY; // Use API_KEY from .env
const ACCOUNT_ID = process.env.ACCOUNT_ID; // Use ACCOUNT_ID from .env
const TEMPLATE_PATH = path.join(__dirname, 'reportTemplate.txt');

const args = process.argv.slice(2);

// let ENV = 'prod1'; // default
let DATE_ARG;

process.argv.forEach(arg => {
  if (arg.startsWith('--env=')) {
    ENV = arg.split('=')[1];
  } else if (arg.startsWith('--date=')) {
    DATE_ARG = arg.split('=')[1];
  }
});


const CLUSTER_NAME = `dls-cup-${ENV}-apps`;
console.log(`📦 Using cluster: ${CLUSTER_NAME}`);


const reportDate = DATE_ARG ? moment(DATE_ARG, "YYYY-MM-DD") : moment();

const today = reportDate.format("YYYY-MM-DD 10:00:00+0530");
const yesterday = reportDate.clone().subtract(1, "day").format("YYYY-MM-DD 10:00:00+0530");
const daybfryesterday = reportDate.clone().subtract(2, "day").format("YYYY-MM-DD 10:00:00+0530");

const REPORT_DURATION = `${yesterday} to ${today}`;

// const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// console.log("System Timezone:", systemTimezone);
// console.log("Moment Timezone Offset:", reportDate.format("Z"));
// console.log("Today:", today);

const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const MAX_SERVICES = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;


// === Run NRQL query ===
async function runNRQLQuery(nrql) {
  const query = `{ actor { account(id: ${ACCOUNT_ID}) { nrql(query: "${nrql}") { results } } } }`;
  const response = await fetch('https://api.eu.newrelic.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'API-Key': API_KEY,
    },
    body: JSON.stringify({ query }),
  });

  const json = await response.json();
  return json?.data?.actor?.account?.nrql?.results;
}


// === Get list of ECS services in cluster ===
async function getServiceNames() {
  const nrql = `SELECT uniques(aws.ecs.ServiceName) FROM Metric WHERE aws.ecs.ClusterName = '${CLUSTER_NAME}' LIMIT MAX`;
  const results = await runNRQLQuery(nrql);
  const allServices = results?.[0]?.['uniques.aws.ecs.ServiceName'] || [];
  return MAX_SERVICES === Infinity ? allServices : allServices.slice(0, MAX_SERVICES);
}

// === Get max value of a given metric ===
async function getMaxValue(service, metric) {
  const nrql = `SELECT max(${metric}) FROM Metric WHERE aws.ecs.ClusterName = '${CLUSTER_NAME}' AND aws.ecs.ServiceName = '${service}' SINCE '${yesterday}' UNTIL '${today}'`;
  const results = await runNRQLQuery(nrql);
  return results?.[0]?.[`max.${metric}`] || 0;
}

// === Get avg value of a given metric ===
async function getAvgValue(service, metric) {
  const nrql = `SELECT average(${metric}) FROM Metric WHERE aws.ecs.ClusterName = '${CLUSTER_NAME}' AND aws.ecs.ServiceName = '${service}' SINCE '${yesterday}' UNTIL '${today}'`;
  const results = await runNRQLQuery(nrql);
  return results?.[0]?.[`average.${metric}`] || 0;
}


// === Get max running task count ===
async function getMaxRunningTasks(service) {
  const nrql = `SELECT max(aws.ecs.runningCount.byService) AS 'Running Task Count' FROM Metric WHERE aws.ecs.ClusterName = '${CLUSTER_NAME}' AND aws.ecs.ServiceName = '${service}' SINCE '${yesterday}' UNTIL '${today}'`;
  const results = await runNRQLQuery(nrql);
  return results?.[0]?.['Running Task Count'] || 0;
}

// === Get timeseries data for a given metric ===
async function getTimeseries(service, metric) {
  const nrql = `SELECT average(${metric}), max(${metric}), min(${metric}) FROM Metric WHERE aws.ecs.ClusterName = '${CLUSTER_NAME}' AND aws.ecs.ServiceName = '${service}' SINCE '${yesterday}' UNTIL '${today}' TIMESERIES`;
  return await runNRQLQuery(nrql);
}

function generateReportContent(templatePath, dataMap) {
  let template = fs.readFileSync(templatePath, 'utf-8');

  for (const key in dataMap) {
    const value = dataMap[key];
    const doubleBrace = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    const doubleAngle = new RegExp(`<<\\s*${key}\\s*>>`, 'g');
    template = template.replace(doubleBrace, value);
    template = template.replace(doubleAngle, value);
  }

  return template;
}

function clearOutputDir(env) {
  const dir = path.join(__dirname, "outputs", env);
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(file => fs.unlinkSync(path.join(dir, file)));
    console.log(`🧹 Cleared old files in outputs/${env}`);
  } else {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created outputs/${env} directory`);
  }
}

// === MAIN FLOW ===
async function main() {
  clearOutputDir(ENV);
  try {
    const services = await getServiceNames();
    console.log(`Services selected (${services.length}): ${services.join(', ')}`);

    const excludedApps = ['NotificationsAppWeb', 'SupportAdminAppWeb', 'DashboardWeb','MobileGatewayAppWeb','NlpAppWeb','OnboardingWeb','FocAppWeb','LearningpathWeb','ClassAppWeb','IeltsAppWeb'];

    for (const service of services) {

      if (excludedApps.includes(service)) {
        console.log(`⛔ Skipping excluded app: ${service}`);
        continue;
      }
      console.log(`\n📊 Processing: ${service}`);

      const maxTasks = await getMaxRunningTasks(service);
      const maxCpu = await getMaxValue(service, 'aws.ecs.CPUUtilization.byService');
      const maxMem = await getMaxValue(service, 'aws.ecs.MemoryUtilization.byService');
      const avgCpu = await getAvgValue(service, 'aws.ecs.CPUUtilization.byService');
      const avgMem = await getAvgValue(service, 'aws.ecs.MemoryUtilization.byService');

      const cpuSeries = await getTimeseries(service, 'aws.ecs.CPUUtilization.byService');
      const memSeries = await getTimeseries(service, 'aws.ecs.MemoryUtilization.byService');

      await generateChart(service, 'aws.ecs.CPUUtilization.byService', cpuSeries, 'CPU Utilization');
      await generateChart(service, 'aws.ecs.MemoryUtilization.byService', memSeries, 'Memory Utilization');

      const reportData = {
        SERVICE_NAME: service,
        DATE: REPORT_DURATION,
        ECS_CLUSTER_NAME: CLUSTER_NAME,
        ENV: ENV,
        TOTAL_TASKS: maxTasks,
        AVG_CPU_UTILIZATION: avgCpu.toFixed(2),
        AVG_MEMORY_UTILIZATION: avgMem.toFixed(2),
        MAX_CPU_USAGE: maxCpu.toFixed(2),
        MAX_MEMORY_USAGE: maxMem.toFixed(2),
        // CPU_CHART: `${service}_cpuutilization_chart.png`,
        // MEMORY_CHART: `${service}_memoryutilization_chart.png`
      };

      const reportText = generateReportContent(TEMPLATE_PATH, reportData);

      const outputDir = path.join(__dirname, 'outputs', ENV);

      const reportPath = path.join(outputDir, `report_${service}.txt`);

      fs.writeFileSync(reportPath, reportText);
      console.log(`✅ Report written to ${reportPath}`);

      try {
        await sendEmail(0, ENV, service);
      } catch (err) {
        console.error(`❌ Failed to send email for ${service}:`, err.message);
      }

      await checkAndUpdateExpiresIn(); // Ensure valid Basecamp token
      await postToBasecamp(service, ENV);
    }
  } catch (err) {
    console.error('❌ Error:', err);
    await sendEmail(1);

  }
};

main();
