fetch('Buctril_Super_DS.csv')
  .then(response => response.text())
  .then(text => {
    const rows = text.trim().split('\n').map(row => row.split(','));
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const output = document.getElementById('output');

    let table = '<table><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
    dataRows.forEach(row => {
      table += '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>';
    });
    table += '</table>';
    output.innerHTML = table;

    // Try rendering a chart using first numeric column if available
    const labels = dataRows.map(r => r[0]);
    const values = dataRows.map(r => parseFloat(r[1]) || 0);

    new Chart(document.getElementById('growthChart').getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: headers[1],
          data: values,
          borderWidth: 2,
          fill: false,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  })
  .catch(err => console.error('Failed to load CSV:', err));