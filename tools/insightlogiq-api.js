(function () {
  const tools = window.InsightLogiqTools;
  const API_CONTRACT = {
    version: 1,
    operations: {
      getQuotation: {
        method: "GET",
        request: {
          quotationId: { type: "string" }
        },
        response: { required: ["quotation"] }
      },
      saveQuotation: {
        method: "POST",
        type: "quotation",
        request: {
          clientName: { type: "string" },
          sites: { type: "array", minItems: 1 },
          grandSubtotal: { type: "number" },
          discountAmount: { type: "number" },
          gstAmount: { type: "number" },
          total: { type: "number" }
        },
        response: { required: ["quotationId"] }
      },
      saveInvoice: {
        method: "POST",
        type: "invoice",
        request: {
          quotationId: { type: "string" },
          clientName: { type: "string" },
          invoiceDate: { type: "string" },
          sites: { type: "array", minItems: 1 },
          amount: { type: "number" },
          amountPaid: { type: "number" },
          balanceDue: { type: "number" },
          paymentMode: { type: "string", allowEmpty: true }
        },
        response: { required: ["invoiceId"] }
      }
    }
  };

  function validatePayload(payload, operation) {
    Object.entries(operation.request).forEach(([field, rule]) => {
      const value = payload[field];
      const validType = rule.type === "array" ? Array.isArray(value) : typeof value === rule.type;
      if (value === undefined || value === null || !validType || (rule.type === "number" && !Number.isFinite(value))) {
        throw new Error(`Invalid or missing field: ${field}.`);
      }
      if (rule.type === "string" && !rule.allowEmpty && !value.trim()) {
        throw new Error(`Invalid or missing field: ${field}.`);
      }
      if (rule.minItems && value.length < rule.minItems) {
        throw new Error(`${field} must contain at least ${rule.minItems} item.`);
      }
    });
  }

  async function send(operationName, payload) {
    const operation = API_CONTRACT.operations[operationName];
    if (!operation) throw new Error(`Unsupported API operation: ${operationName}.`);
    validatePayload(payload, operation);

    const url = new URL(tools.SCRIPT_URL);
    const options = { method: operation.method, redirect: "follow" };
    if (operation.method === "GET") {
      Object.entries(payload).forEach(([key, value]) => url.searchParams.set(key, value));
      url.searchParams.set("_contractVersion", API_CONTRACT.version);
    } else {
      options.headers = { "Content-Type": "text/plain;charset=utf-8" };
      options.body = JSON.stringify({ ...payload, _contractVersion: API_CONTRACT.version });
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error("Could not reach Apps Script. Check your connection and deployment URL.");
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("Apps Script returned an invalid response.");
    }

    if (!response.ok || result?.result !== "success") {
      const apiError = result?.error;
      if (["CONTRACT_MISMATCH", "INVALID_REQUEST", "UNKNOWN_OPERATION"].includes(apiError?.code)) {
        console.error("[InsightLogiq] Possible server/client API contract mismatch.", {
          clientContractVersion: API_CONTRACT.version,
          serverErrorCode: apiError.code,
          serverMessage: apiError.message,
        });
      }
      throw new Error(result?.error?.message || result?.message || "Apps Script could not complete the request.");
    }
    operation.response.required.forEach((field) => {
      if (result[field] === undefined || result[field] === null) {
        throw new Error(`Apps Script response is missing ${field}.`);
      }
    });
    return result;
  }

  window.InsightLogiqApi = {
    contract: API_CONTRACT,
    getQuotation(quotationId) {
      return send("getQuotation", { action: "getQuotation", quotationId });
    },
    save(payload) {
      const operationName = payload?.type === "quotation" ? "saveQuotation"
        : payload?.type === "invoice" ? "saveInvoice"
          : "";
      if (!operationName) throw new Error("Request type must be quotation or invoice.");
      return send(operationName, payload);
    },
  };
}());