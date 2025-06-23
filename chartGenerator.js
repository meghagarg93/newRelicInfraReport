const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');
const ChartjsPluginAnnotation = require('chartjs-plugin-annotation');
const { env } = require('process');

const width = 1500;
const height = 600;

const chartJSNodeCanvas = new ChartJSNodeCanvas({
  width,
  height,
  chartCallback: (ChartJS) => {
    ChartJS.register(ChartjsPluginAnnotation);
  }
});

async function generateChart(serviceName, metricName, timeseriesData, title) {
  if (!timeseriesData || timeseriesData.length === 0) {
    console.warn(`⚠️ No data for chart: ${title} (${serviceName})`);
    return;
  }

  const labels = timeseriesData.map(item =>
    new Date(item.beginTimeSeconds * 1000).toLocaleString()
  );

  const averageValues = timeseriesData.map(item => item[`average.${metricName}`] || 0);
  const maxValues = timeseriesData.map(item => item[`max.${metricName}`] || 0);
  const minValues = timeseriesData.map(item => item[`min.${metricName}`] || 0);

  let maxVal = -Infinity;
  let maxIndex = 0;
  maxValues.forEach((v, i) => {
    if (v > maxVal) {
      maxVal = v;
      maxIndex = i;
    }
  });
  const maxLabel = labels[maxIndex];

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Average',
          data: averageValues,
          borderColor: 'blue',
          backgroundColor: 'blue',
          fill: false,
          tension: 0.2
        },
        {
          label: 'Max',
          data: maxValues,
          borderColor: 'red',
          backgroundColor: 'red',
          fill: false,
          tension: 0.2
        },
        {
          label: 'Min',
          data: minValues,
          borderColor: 'green',
          backgroundColor: 'green',
          fill: false,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: false,
      scales: {
        x: {
          title: {
            display: true,
            text: 'Time'
          }
        },
        y: {
          title: {
            display: true,
            text: `${metricName.includes('CPU') ? 'CPU %' : 'Memory %'}`
          }
        }
      },
      plugins: {
        annotation: {
          annotations: {
            highPointLine: {
              type: 'line',
              xMin: maxLabel,
              xMax: maxLabel,
              borderColor: 'orange',
              borderWidth: 2,
              borderDash: [6, 6],
              label: {
                display: true,
                content: `Peak: ${maxVal.toFixed(2)}%`,
                position: 'end',
                backgroundColor: 'orange',
                color: 'white',
                font: {
                  weight: 'bold'
                }
              }
            }
          }
        },
        legend: {
          position: 'top'
        },
        tooltip: {
          enabled: true
        },
        title: {
          display: true,
          text: `${title} (${serviceName})`,
          font: { size: 18 }
        }
      }
    }
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(config);
  const safeTitle = title.toLowerCase().replace(/\s+/g, '');
  const outputDir = path.join(__dirname, 'outputs', ENV);
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `${serviceName}_${ENV}_${safeTitle}_chart.png`;
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, imageBuffer);
  console.log(`📈 Chart saved: ${outputPath}`);
  return fileName;
}

module.exports = generateChart;
