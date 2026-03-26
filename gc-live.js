// Overrides loadGCDataThen to use live Netlify function
async function loadGCDataThen(cb){
  if(window.GC_DATA_LOADED){ cb(); return; }
  try {
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
    if(!window.GC_CLIENTS) window.GC_CLIENTS=[];
    if(!window.GC_PAYMENTS_BY_CID) window.GC_PAYMENTS_BY_CID={};
    if(!window.GC_FAILED) window.GC_FAILED=[];
    window.GC_DATA_LOADED=true;
    cb();
  } catch(e) {
    console.warn('Live GC failed, falling back to gc-data.js:', e);
    var s=document.createElement('script');
    s.src='gc-data.js?v=3';
    s.onload=function(){ window.GC_DATA_LOADED=true; cb(); };
    document.head.appendChild(s);
  }
}
