// Uses live Netlify function for monthly totals
// Falls back to gc-data.js for client history
async function loadGCDataThen(cb){
  if(window.GC_DATA_LOADED){ cb(); return; }
  try {
    // Load client history from static file first
    await new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = 'gc-data.js?v=3';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });

    // Then override monthly totals with live data
    const res = await fetch('/.netlify/functions/gocardless');
    const data = await res.json();
    const months = Object.keys(data.monthly).sort();
    const mNames=['Jan','Feb','Mar','Apr','May','Jun','Jul',
                  'Aug','Sep','Oct','Nov','Dec'];
    window.GC_MONTHLY = months.map(k => {
      const [yr, mo] = k.split('-');
      return {
        month: yr+'-'+mNames[parseInt(mo)-1],
        total: data.monthly[k].total/100,
        payment_count: data.monthly[k].count
      };
    });

    window.GC_DATA_LOADED = true;
    cb();
  } catch(e) {
    console.warn('Error in gc-live.js:', e);
    // Full fallback to static data only
    var s = document.createElement('script');
    s.src = 'gc-data.js?v=3';
    s.onload = function(){ window.GC_DATA_LOADED=true; cb(); };
    document.head.appendChild(s);
  }
}
