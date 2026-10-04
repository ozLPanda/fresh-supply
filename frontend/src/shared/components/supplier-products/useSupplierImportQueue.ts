import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSupplierImports,
  fetchSupplierSyncStatus,
  retrySupplierImport,
  SUPPLIER_IMPORTS_KEY,
  SUPPLIER_PRODUCTS_KEY,
} from "@/shared/api/supplierProducts";
import { useEffect } from "react";

export function useSupplierImportQueue(userId?: number, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...SUPPLIER_IMPORTS_KEY, userId],
    queryFn: fetchSupplierImports,
    enabled,
    refetchInterval: 5000,
    retry: false,
  });
  const syncStatus = useQuery({
    queryKey: ["supplier-product-sync-status", userId],
    queryFn: fetchSupplierSyncStatus,
    enabled,
    refetchInterval: 5000,
    retry: false,
  });
  const retry = useMutation({
    mutationFn: retrySupplierImport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUPPLIER_IMPORTS_KEY }),
  });
  const revision = query.data
    ?.map((job) => `${job.id}:${job.processed}:${job.updatedAt}`)
    .join(";");
  useEffect(() => {
    if (revision) void queryClient.invalidateQueries({ queryKey: SUPPLIER_PRODUCTS_KEY });
  }, [revision, queryClient]);
  return { query, retry, syncStatus };
}
