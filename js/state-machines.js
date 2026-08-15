export function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("القيمة المالية غير صالحة.");
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function nextBeneficiaryStatus(current) {
  if (current === "approved") return "suspended";
  if (current === "suspended") return "approved";
  throw new Error("لا يمكن تفعيل أو إيقاف المستفيد قبل اعتماده. استخدم زر «اعتماد» أولاً.");
}

export function nextCampaignDistributorStatus(current) {
  if (current === "active") return "suspended";
  if (current === "suspended") return "active";
  throw new Error("التخصيص الذي تمت تسويته يحتاج إجراء «إعادة فتح».");
}

export function nextDeviceStatus(current) {
  return current === "approved" ? "blocked" : "approved";
}

export function settleAllocation(allocation) {
  const allocated = money(allocation.allocated_amount || 0);
  const spent = money(allocation.spent_amount || 0);
  const returned = money(allocation.returned_amount || 0);
  const remaining = money(allocated - spent - returned);
  if (remaining < 0) throw new Error("بيانات التخصيص غير متوازنة.");
  return { ...allocation, returned_amount: money(returned + remaining), settled_return_amount: remaining, remaining_amount: 0, status: "settled" };
}

export function reopenAllocation(allocation, availableUnallocated) {
  if (allocation.status !== "settled" || !allocation.settled_at) throw new Error("هذا التخصيص لم يُقفل بتسوية قابلة للعكس.");
  const returned = money(allocation.returned_amount || 0);
  const automaticReturn = money(allocation.settled_return_amount || 0);
  if (automaticReturn < 0 || automaticReturn > returned) throw new Error("قيمة المرتجع الناتج عن التسوية غير متوازنة.");
  if (availableUnallocated === undefined || availableUnallocated === null) throw new Error("تعذر التحقق من الرصيد غير المخصص للحملة.");
  if (money(availableUnallocated) < automaticReturn) throw new Error("لا يمكن إعادة الفتح لأن مبلغ التسوية أُعيد تخصيصه.");
  const restoredReturned = money(returned - automaticReturn);
  return {
    ...allocation,
    returned_amount: restoredReturned,
    settled_return_amount: 0,
    remaining_amount: money(Number(allocation.allocated_amount || 0) - Number(allocation.spent_amount || 0) - restoredReturned),
    settled_at: null,
    status: "active"
  };
}

export function cancelPaymentAgainstAllocation(allocation, paymentAmount) {
  const amount = money(paymentAmount);
  const allocated = money(allocation.allocated_amount || 0);
  const spent = money(allocation.spent_amount || 0);
  const returned = money(allocation.returned_amount || 0);
  if (amount <= 0 || spent < amount) throw new Error("تعذر عكس الصرف بسبب عدم تطابق إجمالي مصروف الموزع.");
  const newSpent = money(spent - amount);
  if (allocation.status === "settled" && allocation.settled_at) {
    if (Math.abs(money(allocated - spent - returned)) > 0.009) throw new Error("بيانات التسوية غير متوازنة.");
    const newReturned = money(returned + amount);
    return {
      ...allocation,
      spent_amount: newSpent,
      returned_amount: newReturned,
      settled_return_amount: money(Number(allocation.settled_return_amount || 0) + amount),
      remaining_amount: 0,
      status: "settled"
    };
  }
  return {
    ...allocation,
    spent_amount: newSpent,
    remaining_amount: money(allocated - newSpent - returned),
    status: allocation.status === "settled" ? "active" : allocation.status
  };
}

export function validateCashTransfer({ from, to, amount }) {
  if (!from || !to) throw new Error("تعذر العثور على أحد الصندوقين.");
  if (String(from.id) === String(to.id)) throw new Error("لا يمكن التحويل إلى نفس الصندوق.");
  if (from.is_active === false || to.is_active === false) throw new Error("لا يمكن التحويل من أو إلى صندوق موقوف.");
  if (from.currency !== to.currency) throw new Error("لا يمكن التحويل بين عملتين مختلفتين.");
  const requested = money(amount);
  if (requested <= 0) throw new Error("مبلغ التحويل يجب أن يكون أكبر من صفر.");
  if (money(from.current_balance || 0) < requested) throw new Error("رصيد الصندوق المحول منه غير كافٍ.");
  return { amount: requested, currency: from.currency };
}
