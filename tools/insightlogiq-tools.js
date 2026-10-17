(function () {
  const GST_RATE = 0.18;
  const ADDON_DEFS = [
    { addOnId: "customUI", label: "Custom design / UI", defaultPrice: 5000 },
    { addOnId: "logoDesign", label: "Logo / branding design", defaultPrice: 4500 },
    { addOnId: "multiLang", label: "Multi-language support", defaultPrice: 6000 },
    { addOnId: "animation", label: "Advanced animation", defaultPrice: 9000 },
    { addOnId: "domainHost", label: "Domain & hosting purchase", defaultPrice: 3500 },
    { addOnId: "extraRevision", label: "Additional revision round", defaultPrice: 2500 },
  ];
  const COMMON_ADDON_DEFS = [
    { addOnId: "baseCharge", label: "Base website charge", pricingModel: "perWebsite", defaultPrice: 3000 },
    { addOnId: "perPageCharge", label: "Extra page charge ", pricingModel: "perPage", defaultPrice: 500 },
  ];

  function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function currency(value) {
    const safeValue = Math.max(0, toNumber(value, 0));
    return "₹" + (Math.round(safeValue * 100) / 100).toLocaleString("en-IN");
  }

  function getAddonCatalog() {
    return ADDON_DEFS.map((addon) => ({ ...addon }));
  }

  function getCommonAddonCatalog() {
    return COMMON_ADDON_DEFS.map((addon) => ({ ...addon }));
  }

  function resolveAddonMeta(addon = {}) {
    const lookup = ADDON_DEFS.find((item) => item.addOnId === (addon.addOnId || addon.id || addon.key)) || null;
    const resolvedAddOnId = addon.addOnId || addon.id || addon.key || lookup?.addOnId || "custom";
    const resolvedLabel = addon.label || lookup?.label || "Additional Service";
    const resolvedPrice = Math.max(0, toNumber(addon.defaultPrice ?? addon.unitPrice ?? addon.price ?? lookup?.defaultPrice ?? 0, 0));
    const quantity = Math.max(1, toNumber(addon.quantity ?? addon.qty ?? 1, 1));
    const isSelected = Boolean(addon.isSelected ?? addon.selected ?? addon.checked ?? true);
    const amount = Math.max(0, toNumber(addon.amount ?? (isSelected ? resolvedPrice * quantity : 0), 0));

    return {
      addOnId: resolvedAddOnId,
      key: resolvedAddOnId,
      id: resolvedAddOnId,
      label: resolvedLabel,
      defaultPrice: resolvedPrice,
      unitPrice: resolvedPrice,
      price: resolvedPrice,
      quantity,
      isSelected,
      checked: isSelected,
      selected: isSelected,
      amount,
    };
  }

  function calculateTotals({ subtotal = 0, discountType = "percent", discountValue = 0, gstRate = GST_RATE } = {}) {
    const safeSubtotal = Math.max(0, toNumber(subtotal, 0));
    const safeDiscountType = discountType === "flat" ? "flat" : "percent";
    const safeDiscountValue = Math.max(0, toNumber(discountValue, 0));
    const discountAmount = safeDiscountType === "percent"
      ? Math.min(safeDiscountValue, 100) * safeSubtotal / 100
      : safeDiscountValue;
    const normalizedDiscount = Math.min(Math.max(0, toNumber(discountAmount, 0)), safeSubtotal);
    const discountedSubtotal = Math.max(0, safeSubtotal - normalizedDiscount);
    const gstAmount = discountedSubtotal * gstRate;
    const total = discountedSubtotal + gstAmount;

    return {
      subtotal: safeSubtotal,
      discountType: safeDiscountType,
      discountValue: safeDiscountValue,
      discountAmount: normalizedDiscount,
      discountedSubtotal,
      gstRate,
      gstAmount,
      total,
    };
  }

  function normalizeQuotationSite(site = {}, index = 0) {
    const siteName = site.name || `Website ${index + 1}`;
    const siteId = site.addOnId || site.id || `site-${index + 1}`;
    const addons = Array.isArray(site.addons) ? site.addons.map((addon) => resolveAddonMeta(addon)) : [];
    const base = Math.max(0, toNumber(site.base ?? site.basePrice, 0));
    const subtotal = Math.max(0, toNumber(site.subtotal, base + addons.reduce((sum, addon) => sum + (addon.isSelected ? addon.amount : 0), 0)));

    return {
      addOnId: siteId,
      id: siteId,
      name: siteName,
      base,
      addons,
      subtotal,
    };
  }

  function buildInvoiceFromQuotation(quotation = {}, selectedSiteId = null) {
    const quote = quotation || {};
    const sites = Array.isArray(quote.sites) ? quote.sites.map(normalizeQuotationSite) : [];
    const resolvedSite = sites.find((site) => site.addOnId === selectedSiteId)
      || sites[0]
      || {
        addOnId: "site-1",
        id: "site-1",
        name: "Website 1",
        base: 0,
        addons: [],
        subtotal: 0,
      };

    return {
      quotationId: quote.quotationId || quote.id || "",
      clientName: quote.clientName || "",
      websiteName: resolvedSite.name,
      addOnId: resolvedSite.addOnId,
      base: resolvedSite.base,
      addonsAll: resolvedSite.addons.map((addon) => ({
        addOnId: addon.addOnId,
        key: addon.key,
        label: addon.label,
        checked: addon.isSelected,
        amount: addon.amount,
        unitPrice: addon.unitPrice,
      })),
      subtotal: resolvedSite.subtotal,
      discountType: quote.discountType || "percent",
      discountValue: toNumber(quote.discountValue, 0),
      discountAmount: toNumber(quote.discountAmount, 0),
      gstAmount: toNumber(quote.gstAmount, 0),
      amount: toNumber(quote.total, resolvedSite.subtotal),
    };
  }

  function setStatus(selector, message = "", isError = false) {
    const statusEl = document.querySelector(selector);
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = isError ? "status err" : "status";
  }

  async function downloadPdf(element, filename) {
    if (typeof window.html2pdf !== "function") {
      throw new Error("The PDF generator did not load. Check your connection and try again.");
    }
    if (!element || !element.textContent.trim()) {
      throw new Error("There is no preview content to download.");
    }

    const capture = element.cloneNode(true);
    const captureLayer = document.createElement("div");
    Object.assign(captureLayer.style, {
      position: "fixed",
      top: "0",
      left: "0",
      zIndex: "49",
      width: "190mm",
      background: "#fff",
      pointerEvents: "none",
    });
    Object.assign(capture.style, {
      display: "block",
      width: "100%",
      maxWidth: "190mm",
      margin: "0",
      background: "#fff",
    });
    captureLayer.appendChild(capture);
    document.body.appendChild(captureLayer);

    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const width = Math.ceil(capture.getBoundingClientRect().width);
      const height = Math.ceil(capture.scrollHeight);
      if (!width || !height) throw new Error("The preview could not be laid out for PDF capture.");

      await window.html2pdf().set({
        margin: 10,
        filename,
        image: { type: "jpeg", quality: 0.98 },
        pagebreak: {
          mode: ["css", "legacy"],
          avoid: ["tr", ".doc-header", ".doc-subtitle", "h4.doc-h", ".doc-sig"],
        },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          scrollX: 0,
          scrollY: 0,
          windowWidth: width,
          windowHeight: height,
          x: 0,
          y: 0, 
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      }).from(capture).save();
    } finally {
      captureLayer.remove();
    }
  }

  window.InsightLogiqTools = {
    GST_RATE,
    ADDON_DEFS,
    COMMON_ADDON_DEFS,
    currency,
    calculateTotals,
    getAddonCatalog,
    getCommonAddonCatalog,
    resolveAddonMeta,
    normalizeQuotationSite,
    buildInvoiceFromQuotation,
    setStatus,
    downloadPdf,
    SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyQDojJeaAHB9YIsGEBnIqYGlxvFf5VamqHvjK9KDYkT57GnCAKndv02Da6TtFRMTMvMQ/exec",
  };
}());
