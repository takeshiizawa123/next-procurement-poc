(function() {
  var FORM_URL = 'https://next-procurement-poc.vercel.app/purchase/new';
  var host = location.hostname;
  var title = '';
  var price = '';
  var supplier = '';
  var pageUrl = location.href;

  // --- Amazon ---
  if (host.indexOf('amazon') >= 0) {
    supplier = 'Amazon';
    var el = document.getElementById('productTitle');
    if (el) title = el.innerText.trim();
    if (!title) {
      el = document.querySelector('#title');
      if (el) title = el.innerText.trim();
    }
    // 価格: 複数セレクタで試行
    var pe = document.querySelector('.a-price .a-offscreen');
    if (pe) price = pe.innerText.replace(/[^0-9]/g, '');
    if (!price) {
      pe = document.querySelector('.a-price-whole');
      if (pe) price = pe.innerText.replace(/[^0-9]/g, '');
    }
    if (!price) {
      pe = document.getElementById('priceblock_ourprice') || document.getElementById('priceblock_dealprice');
      if (pe) price = pe.innerText.replace(/[^0-9]/g, '');
    }
    // マーケットプレイス出品者名
    var se = document.getElementById('sellerProfileTriggerId') || document.querySelector('#merchant-info a');
    if (se) {
      var sn = se.innerText.trim();
      if (sn && sn !== 'Amazon.co.jp' && sn !== 'Amazon') {
        supplier = 'Amazon (' + sn + ')';
      }
    }
  }
  // --- モノタロウ ---
  else if (host.indexOf('monotaro') >= 0) {
    supplier = 'モノタロウ';
    var h1 = document.querySelector('h1');
    if (h1) title = h1.innerText.trim();
    pe = document.querySelector('[class*="ProductPrice"], [class*="selling-price"]');
    if (pe) price = pe.innerText.replace(/[^0-9]/g, '');
  }
  // --- ASKUL ---
  else if (host.indexOf('askul') >= 0) {
    supplier = 'ASKUL';
    h1 = document.querySelector('h1');
    if (h1) title = h1.innerText.trim();
    pe = document.querySelector('[class*="price"], .priceValue');
    if (pe) price = pe.innerText.replace(/[^0-9]/g, '');
  }
  // --- ヨドバシ ---
  else if (host.indexOf('yodobashi') >= 0) {
    supplier = 'ヨドバシ.com';
    h1 = document.querySelector('h1');
    if (h1) title = h1.innerText.trim();
    pe = document.querySelector('.productPrice .price');
    if (pe) price = pe.innerText.replace(/[^0-9]/g, '');
  }
  // --- ビックカメラ ---
  else if (host.indexOf('biccamera') >= 0) {
    supplier = 'ビックカメラ';
    h1 = document.querySelector('h1');
    if (h1) title = h1.innerText.trim();
    pe = document.querySelector('.bcs_price, .productPrice');
    if (pe) price = pe.innerText.replace(/[^0-9]/g, '');
  }
  // --- 汎用 ---
  else {
    supplier = host.replace('www.', '');
    var og = document.querySelector('meta[property="og:title"]');
    title = og ? og.getAttribute('content') : document.title;
    var op = document.querySelector('meta[property="product:price:amount"]');
    if (op) price = op.getAttribute('content').replace(/[^0-9]/g, '');
  }

  // user_id（初回のみ入力、以後はlocalStorageから取得）
  var uid = localStorage.getItem('procurement_user_id');
  if (!uid) {
    uid = prompt('Slack User ID を入力してください（初回のみ）\n\nSlackプロフィール > ... > メンバーIDをコピー');
    if (uid) localStorage.setItem('procurement_user_id', uid);
  }

  // フォームURLを構築
  var params = [];
  if (uid) params.push('user_id=' + encodeURIComponent(uid));
  if (title) params.push('item_name=' + encodeURIComponent(title));
  if (price) params.push('price=' + encodeURIComponent(price));
  if (supplier) params.push('supplier_name=' + encodeURIComponent(supplier));
  params.push('url=' + encodeURIComponent(pageUrl));

  var result = FORM_URL + '?' + params.join('&');

  // 結果通知
  var msg = '購買申請フォームを開きます\n\n';
  msg += '品名: ' + (title || '(取得できませんでした)') + '\n';
  msg += '価格: ' + (price ? '¥' + Number(price).toLocaleString() : '(取得できませんでした)') + '\n';
  msg += '購入先: ' + supplier;

  if (confirm(msg + '\n\nOKで申請フォームを開きます')) {
    window.open(result, '_blank');
  }
})();
