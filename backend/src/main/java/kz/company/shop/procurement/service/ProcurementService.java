package kz.company.shop.procurement.service;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.procurement.dto.*;
import kz.company.shop.procurement.entity.*;
import kz.company.shop.procurement.repository.*;
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ProcurementService {
    private static final Set<String> COMPANY_PRICE_CURRENCIES = Set.of("KZT", "USD", "CNY");

    private final ProcurementProjectRepository projects;
    private final ProcurementCompanyRepository companies;
    private final ProcurementCompanyLinkRepository companyLinks;
    private final ProcurementCompanyNoteRepository companyNotes;
    private final ProcurementFileRepository files;
    private final ProcurementPaymentRepository payments;
    private final ProcurementStatusHistoryRepository statusHistory;
    private final FileStorageService fileStorage;
    private final AuditService audit;

    public ProcurementService(
            ProcurementProjectRepository projects,
            ProcurementCompanyRepository companies,
            ProcurementCompanyLinkRepository companyLinks,
            ProcurementCompanyNoteRepository companyNotes,
            ProcurementFileRepository files,
            ProcurementPaymentRepository payments,
            ProcurementStatusHistoryRepository statusHistory,
            FileStorageService fileStorage,
            AuditService audit) {
        this.projects = projects;
        this.companies = companies;
        this.companyLinks = companyLinks;
        this.companyNotes = companyNotes;
        this.files = files;
        this.payments = payments;
        this.statusHistory = statusHistory;
        this.fileStorage = fileStorage;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public PageResult<ProcurementProjectDto> list(
            ProcurementStatus status, String search, int page, int size) {
        PageRequest pageRequest =
                PageRequest.of(Math.max(page, 1) - 1, Math.min(Math.max(size, 1), 100));
        Page<ProcurementProject> result = findProjects(status, search, pageRequest);
        return new PageResult<>(
                result.getContent().stream().map(project -> toDto(project, false)).toList(),
                result.getNumber() + 1,
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    private Page<ProcurementProject> findProjects(
            ProcurementStatus status, String search, PageRequest pageRequest) {
        List<String> variants = ProductSearchTextNormalizer.rawSearchVariants(search);
        if (variants.isEmpty()) {
            return status == null
                    ? projects.findAllByOrderByUpdatedAtDesc(pageRequest)
                    : projects.findByStatusOrderByUpdatedAtDesc(status, pageRequest);
        }

        for (String variant : variants) {
            Page<ProcurementProject> result =
                    status == null
                            ? projects.findByNameContainingIgnoreCaseOrderByUpdatedAtDesc(
                                    variant, pageRequest)
                            : projects.findByStatusAndNameContainingIgnoreCaseOrderByUpdatedAtDesc(
                                    status, variant, pageRequest);
            if (!result.isEmpty()) return result;
        }

        String fallback = variants.getFirst();
        return status == null
                ? projects.findByNameContainingIgnoreCaseOrderByUpdatedAtDesc(fallback, pageRequest)
                : projects.findByStatusAndNameContainingIgnoreCaseOrderByUpdatedAtDesc(
                        status, fallback, pageRequest);
    }

    @Transactional(readOnly = true)
    public ProcurementProjectDto get(Long projectId) {
        return toDto(getProject(projectId), true);
    }

    @Transactional
    public ProcurementProjectDto create(ProcurementProjectRequest request, CurrentUser actor) {
        ProcurementProject project = new ProcurementProject();
        apply(project, request);
        project.createdByUserId = actor.id();
        ProcurementProject saved = projects.save(project);
        audit.record("CREATE", "PROCUREMENT_PROJECT", saved.id, "Создан проект закупки из Китая");
        return toDto(saved, true);
    }

    @Transactional
    public ProcurementProjectDto update(Long projectId, ProcurementProjectRequest request) {
        ProcurementProject project = getProject(projectId);
        apply(project, request);
        ProcurementProject saved = projects.save(project);
        audit.record("UPDATE", "PROCUREMENT_PROJECT", saved.id, "Обновлён проект закупки из Китая");
        return toDto(saved, true);
    }

    @Transactional
    public void delete(Long projectId) {
        ProcurementProject project = getProject(projectId);
        List<ProcurementFile> attached =
                files.findByProjectIdAndCompanyIdIsNullOrderByCreatedAtDesc(projectId);
        List<ProcurementCompany> projectCompanies =
                companies.findByProjectIdOrderByCreatedAtAsc(projectId);
        if (!projectCompanies.isEmpty()) {
            attached = new java.util.ArrayList<>(attached);
            attached.addAll(
                    files.findByCompanyIdInOrderByCreatedAtDesc(
                            projectCompanies.stream().map(company -> company.id).toList()));
        }
        projects.delete(project);
        attached.forEach(file -> fileStorage.deleteProcurementDocument(file.fileName));
        audit.record("DELETE", "PROCUREMENT_PROJECT", projectId, "Удалён проект закупки из Китая");
    }

    @Transactional
    public ProcurementProjectDto changeStatus(
            Long projectId, ProcurementStatusChangeRequest request, CurrentUser actor) {
        ProcurementProject project = getProject(projectId);
        ProcurementStatus oldStatus = project.status;
        ProcurementStatus newStatus = request.status();
        if (!isAllowedTransition(oldStatus, newStatus)) {
            throw new AppExceptions.BadRequest("Недопустимый переход статуса");
        }
        String comment = normalize(request.comment());
        if (newStatus == ProcurementStatus.REWORK && comment == null) {
            throw new AppExceptions.BadRequest("Для статуса «Доработка» укажите комментарий");
        }
        project.status = newStatus;
        projects.save(project);
        ProcurementStatusHistory history = new ProcurementStatusHistory();
        history.projectId = project.id;
        history.oldStatus = oldStatus;
        history.newStatus = newStatus;
        history.comment = comment;
        history.actorUserId = actor.id();
        history.actorName = actor.name();
        statusHistory.save(history);
        audit.record(
                "STATUS_CHANGE",
                "PROCUREMENT_PROJECT",
                project.id,
                "Статус закупки изменён с " + oldStatus + " на " + newStatus);
        return toDto(project, true);
    }

    @Transactional(readOnly = true)
    public List<ProcurementStatusHistoryDto> history(Long projectId) {
        getProject(projectId);
        return statusHistory.findByProjectIdOrderByCreatedAtDesc(projectId).stream()
                .map(this::toHistoryDto)
                .toList();
    }

    @Transactional
    public ProcurementCompanyDto addCompany(Long projectId, ProcurementCompanyRequest request) {
        getProject(projectId);
        validateCompanyRequest(request);
        ProcurementCompany company = new ProcurementCompany();
        company.projectId = projectId;
        apply(company, request);
        ProcurementCompany saved = companies.save(company);
        replaceLinks(saved.id, request.links());
        audit.record(
                "CREATE", "PROCUREMENT_COMPANY", saved.id, "Добавлена компания в проект закупки");
        return toCompanyDto(saved, List.of(), List.of());
    }

    @Transactional
    public ProcurementCompanyDto updateCompany(
            Long projectId, Long companyId, ProcurementCompanyRequest request) {
        ProcurementCompany company = getCompany(projectId, companyId);
        validateCompanyRequest(request);
        apply(company, request);
        companies.save(company);
        replaceLinks(company.id, request.links());
        audit.record(
                "UPDATE",
                "PROCUREMENT_COMPANY",
                company.id,
                "Обновлена компания в проекте закупки");
        return toCompanyDto(
                company,
                companyLinks.findByCompanyIdOrderBySortOrderAsc(company.id).stream()
                        .map(this::toLinkDto)
                        .toList(),
                files.findByCompanyIdInOrderByCreatedAtDesc(List.of(company.id)).stream()
                        .map(file -> toFileDto(file, projectId))
                        .toList());
    }

    @Transactional
    public void deleteCompany(Long projectId, Long companyId) {
        ProcurementCompany company = getCompany(projectId, companyId);
        List<ProcurementFile> attached =
                files.findByCompanyIdInOrderByCreatedAtDesc(List.of(companyId));
        companies.delete(company);
        attached.forEach(file -> fileStorage.deleteProcurementDocument(file.fileName));
        audit.record(
                "DELETE", "PROCUREMENT_COMPANY", companyId, "Удалена компания из проекта закупки");
    }

    @Transactional(readOnly = true)
    public List<ProcurementCompanyNoteDto> listCompanyNotes(Long projectId, Long companyId) {
        getCompany(projectId, companyId);
        return companyNotes.findByCompanyIdOrderByCreatedAtAsc(companyId).stream()
                .map(this::toCompanyNoteDto)
                .toList();
    }

    @Transactional
    public ProcurementCompanyNoteDto addCompanyNote(
            Long projectId,
            Long companyId,
            ProcurementCompanyNoteRequest request,
            CurrentUser actor) {
        getCompany(projectId, companyId);
        ProcurementCompanyNote note = new ProcurementCompanyNote();
        note.companyId = companyId;
        note.content = request.content().trim();
        note.authorUserId = actor.id();
        note.authorName = actor.name();
        ProcurementCompanyNote saved = companyNotes.save(note);
        audit.record(
                "CREATE", "PROCUREMENT_COMPANY_NOTE", saved.id, "Добавлена заметка по компании");
        return toCompanyNoteDto(saved);
    }

    @Transactional
    public ProcurementCompanyNoteDto updateCompanyNote(
            Long projectId,
            Long companyId,
            Long noteId,
            ProcurementCompanyNoteRequest request,
            CurrentUser actor) {
        ProcurementCompanyNote note = getCompanyNote(projectId, companyId, noteId);
        requireNoteOwner(note, actor);
        note.content = request.content().trim();
        note.updatedAt = Instant.now();
        ProcurementCompanyNote saved = companyNotes.save(note);
        audit.record(
                "UPDATE", "PROCUREMENT_COMPANY_NOTE", saved.id, "Изменена заметка по компании");
        return toCompanyNoteDto(saved);
    }

    @Transactional
    public void deleteCompanyNote(Long projectId, Long companyId, Long noteId, CurrentUser actor) {
        ProcurementCompanyNote note = getCompanyNote(projectId, companyId, noteId);
        requireNoteOwner(note, actor);
        companyNotes.delete(note);
        audit.record("DELETE", "PROCUREMENT_COMPANY_NOTE", noteId, "Удалена заметка по компании");
    }

    @Transactional
    public ProcurementFileDto uploadProjectFile(
            Long projectId, String displayName, MultipartFile upload, CurrentUser actor) {
        getProject(projectId);
        return uploadFile(projectId, null, displayName, upload, actor);
    }

    @Transactional
    public ProcurementFileDto uploadCompanyFile(
            Long projectId,
            Long companyId,
            String displayName,
            MultipartFile upload,
            CurrentUser actor) {
        getCompany(projectId, companyId);
        return uploadFile(projectId, companyId, displayName, upload, actor);
    }

    @Transactional
    public void deleteFile(Long projectId, Long fileId) {
        ProcurementFile file =
                files.findByIdAndProjectId(fileId, projectId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Файл не найден"));
        files.delete(file);
        fileStorage.deleteProcurementDocument(file.fileName);
        audit.record("DELETE", "PROCUREMENT_FILE", fileId, "Удален файл проекта закупки");
    }

    @Transactional(readOnly = true)
    public ProcurementFile getFile(Long projectId, Long fileId) {
        getProject(projectId);
        return files.findByIdAndProjectId(fileId, projectId)
                .orElseThrow(() -> new AppExceptions.NotFound("Файл не найден"));
    }

    @Transactional
    public ProcurementFileDto updateTextFile(
            Long projectId, Long fileId, ProcurementTextFileUpdateRequest request) {
        ProcurementFile file = getFile(projectId, fileId);
        if (!isPlainText(file.contentType)) {
            throw new AppExceptions.BadRequest("Редактировать можно только текстовые файлы");
        }

        byte[] content = request.text().getBytes(StandardCharsets.UTF_8);
        if (content.length > 50L * 1024 * 1024) {
            throw new AppExceptions.BadRequest("Размер файла не должен превышать 50 МБ");
        }

        fileStorage.updateProcurementTextDocument(file.fileName, content);
        file.fileSize = content.length;
        ProcurementFile saved = files.save(file);
        audit.record("UPDATE", "PROCUREMENT_FILE", fileId, "Изменен текстовый файл закупки");
        return toFileDto(saved, projectId);
    }

    @Transactional
    public ProcurementPaymentDto addPayment(
            Long projectId, ProcurementPaymentRequest request, CurrentUser actor) {
        requirePaidProject(projectId);
        ProcurementPayment payment = new ProcurementPayment();
        payment.projectId = projectId;
        payment.createdByUserId = actor.id();
        apply(payment, request);
        ProcurementPayment saved = payments.save(payment);
        audit.record("CREATE", "PROCUREMENT_PAYMENT", saved.id, "Добавлена оплата закупки");
        return toPaymentDto(saved);
    }

    @Transactional
    public ProcurementPaymentDto updatePayment(
            Long projectId, Long paymentId, ProcurementPaymentRequest request) {
        requirePaidProject(projectId);
        ProcurementPayment payment =
                payments.findByIdAndProjectId(paymentId, projectId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Оплата не найдена"));
        apply(payment, request);
        ProcurementPayment saved = payments.save(payment);
        audit.record("UPDATE", "PROCUREMENT_PAYMENT", paymentId, "Обновлена оплата закупки");
        return toPaymentDto(saved);
    }

    @Transactional
    public void deletePayment(Long projectId, Long paymentId) {
        requirePaidProject(projectId);
        ProcurementPayment payment =
                payments.findByIdAndProjectId(paymentId, projectId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Оплата не найдена"));
        payments.delete(payment);
        audit.record("DELETE", "PROCUREMENT_PAYMENT", paymentId, "Удалена оплата закупки");
    }

    private ProcurementFileDto uploadFile(
            Long projectId,
            Long companyId,
            String displayName,
            MultipartFile upload,
            CurrentUser actor) {
        String safeDisplayName = normalize(displayName);
        if (safeDisplayName == null || safeDisplayName.length() > 500) {
            throw new AppExceptions.BadRequest(
                    "Укажите название файла длиной не более 500 символов");
        }
        var stored = fileStorage.saveProcurementDocument(upload);
        ProcurementFile file = new ProcurementFile();
        file.projectId = projectId;
        file.companyId = companyId;
        file.displayName = safeDisplayName;
        file.fileName = stored.fileName();
        file.filePath = stored.publicPath();
        file.originalFileName = stored.originalFileName();
        file.contentType = upload.getContentType();
        file.fileSize = upload.getSize();
        file.uploadedByUserId = actor.id();
        ProcurementFile saved = files.save(file);
        audit.record("CREATE", "PROCUREMENT_FILE", saved.id, "Добавлен файл проекта закупки");
        return toFileDto(saved, projectId);
    }

    private ProcurementProject getProject(Long id) {
        return projects.findById(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Проект закупки не найден"));
    }

    private static boolean isPlainText(String contentType) {
        return contentType != null
                && "text/plain".equalsIgnoreCase(contentType.split(";", 2)[0].trim());
    }

    private ProcurementCompany getCompany(Long projectId, Long companyId) {
        return companies
                .findByIdAndProjectId(companyId, projectId)
                .orElseThrow(() -> new AppExceptions.NotFound("Компания не найдена"));
    }

    private void requirePaidProject(Long projectId) {
        if (getProject(projectId).status != ProcurementStatus.PAID) {
            throw new AppExceptions.BadRequest(
                    "Оплаты можно вести только для проектов со статусом «Оплачено»");
        }
    }

    private boolean isAllowedTransition(ProcurementStatus from, ProcurementStatus to) {
        return switch (from) {
            case DRAFT -> to == ProcurementStatus.IN_PROGRESS;
            case IN_PROGRESS -> to == ProcurementStatus.READY_FOR_REVIEW;
            case READY_FOR_REVIEW ->
                    to == ProcurementStatus.READY_FOR_PAYMENT || to == ProcurementStatus.REWORK;
            case READY_FOR_PAYMENT -> to == ProcurementStatus.PAID;
            case REWORK -> to == ProcurementStatus.IN_PROGRESS;
            case PAID -> false;
        };
    }

    private void apply(ProcurementProject target, ProcurementProjectRequest source) {
        target.name = source.name().trim();
        target.purchaseInformation = normalize(source.purchaseInformation());
    }

    private void apply(ProcurementCompany target, ProcurementCompanyRequest source) {
        target.name = source.name().trim();
        target.market = normalize(source.market());
        target.marketSinceYear = source.marketSinceYear();
        target.reviewsFromYear = source.reviewsFromYear();
        target.reviewsToYear = source.reviewsToYear();
        target.comment = normalize(source.comment());
        if (source.companyStatus() != null) {
            target.status = source.companyStatus();
            target.decisionComment = normalize(source.decisionComment());
        }
        target.price = source.price();
        target.priceCurrency =
                normalizeCompanyPriceCurrency(source.price(), source.priceCurrency());
    }

    private void apply(ProcurementPayment target, ProcurementPaymentRequest source) {
        target.amount = source.amount();
        target.currency = source.currency().trim().toUpperCase();
        target.paidAt = source.paidAt();
        target.comment = normalize(source.comment());
    }

    private void validateCompanyRequest(ProcurementCompanyRequest request) {
        if (request.companyStatus() == ProcurementCompanyStatus.REJECTED
                && normalize(request.decisionComment()) == null) {
            throw new AppExceptions.BadRequest("Для отклонённой компании укажите причину решения");
        }
        if (request.price() != null && request.price().signum() < 0) {
            throw new AppExceptions.BadRequest("Цена компании не может быть отрицательной");
        }
        if (request.price() != null && request.price().scale() > 2) {
            throw new AppExceptions.BadRequest(
                    "Цена компании может содержать не более двух знаков после запятой");
        }
        if (request.reviewsFromYear() != null
                && request.reviewsToYear() != null
                && request.reviewsToYear() < request.reviewsFromYear()) {
            throw new AppExceptions.BadRequest(
                    "Год окончания отзывов не может быть раньше года начала");
        }
    }

    private String normalizeCompanyPriceCurrency(BigDecimal price, String value) {
        if (price == null) return null;
        String normalized = normalize(value);
        if (normalized == null) return "KZT";
        String currency = normalized.toUpperCase(Locale.ROOT);
        if (!COMPANY_PRICE_CURRENCIES.contains(currency)) {
            throw new AppExceptions.BadRequest("Валюта цены компании должна быть KZT, USD или CNY");
        }
        return currency;
    }

    private void replaceLinks(Long companyId, List<ProcurementCompanyLinkRequest> requests) {
        companyLinks.deleteByCompanyId(companyId);
        List<ProcurementCompanyLinkRequest> safeRequests = requests == null ? List.of() : requests;
        for (int index = 0; index < safeRequests.size(); index++) {
            ProcurementCompanyLinkRequest request = safeRequests.get(index);
            ProcurementCompanyLink link = new ProcurementCompanyLink();
            link.companyId = companyId;
            link.name = request.name().trim();
            link.url = request.url().trim();
            link.sortOrder = index;
            companyLinks.save(link);
        }
    }

    private ProcurementProjectDto toDto(ProcurementProject project, boolean details) {
        List<ProcurementCompany> projectCompanies =
                details ? companies.findByProjectIdOrderByCreatedAtAsc(project.id) : List.of();
        List<Long> companyIds = projectCompanies.stream().map(company -> company.id).toList();
        Map<Long, List<ProcurementCompanyLinkDto>> linksByCompany = groupLinks(companyIds);
        Map<Long, List<ProcurementFileDto>> filesByCompany =
                groupCompanyFiles(companyIds, project.id);
        List<ProcurementPaymentDto> projectPayments =
                payments.findByProjectIdOrderByPaidAtDescCreatedAtDesc(project.id).stream()
                        .map(this::toPaymentDto)
                        .toList();
        BigDecimal totalPaid =
                projectPayments.stream()
                        .map(ProcurementPaymentDto::amount)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new ProcurementProjectDto(
                project.id,
                project.name,
                project.purchaseInformation,
                project.status,
                project.createdByUserId,
                project.createdAt,
                project.updatedAt,
                details ? projectCompanies.size() : companies.countByProjectId(project.id),
                details
                        ? projectCompanies.stream()
                                .map(
                                        company ->
                                                toCompanyDto(
                                                        company,
                                                        linksByCompany.getOrDefault(
                                                                company.id, List.of()),
                                                        filesByCompany.getOrDefault(
                                                                company.id, List.of())))
                                .toList()
                        : List.of(),
                details
                        ? files
                                .findByProjectIdAndCompanyIdIsNullOrderByCreatedAtDesc(project.id)
                                .stream()
                                .map(file -> toFileDto(file, project.id))
                                .toList()
                        : List.of(),
                details ? projectPayments : List.of(),
                List.of(),
                totalPaid);
    }

    private Map<Long, List<ProcurementCompanyLinkDto>> groupLinks(Collection<Long> companyIds) {
        if (companyIds.isEmpty()) return Collections.emptyMap();
        return companyLinks.findByCompanyIdInOrderBySortOrderAsc(companyIds).stream()
                .collect(
                        Collectors.groupingBy(
                                link -> link.companyId,
                                Collectors.mapping(this::toLinkDto, Collectors.toList())));
    }

    private Map<Long, List<ProcurementFileDto>> groupCompanyFiles(
            Collection<Long> companyIds, Long projectId) {
        if (companyIds.isEmpty()) return Collections.emptyMap();
        return files.findByCompanyIdInOrderByCreatedAtDesc(companyIds).stream()
                .map(file -> toFileDto(file, projectId))
                .collect(Collectors.groupingBy(ProcurementFileDto::companyId));
    }

    private ProcurementCompanyDto toCompanyDto(
            ProcurementCompany company,
            List<ProcurementCompanyLinkDto> links,
            List<ProcurementFileDto> companyFiles) {
        return new ProcurementCompanyDto(
                company.id,
                company.name,
                company.market,
                company.marketSinceYear,
                company.reviewsFromYear,
                company.reviewsToYear,
                company.comment,
                company.status,
                company.decisionComment,
                company.price,
                company.priceCurrency,
                links,
                companyFiles,
                company.createdAt,
                company.updatedAt);
    }

    private ProcurementCompanyLinkDto toLinkDto(ProcurementCompanyLink link) {
        return new ProcurementCompanyLinkDto(link.id, link.name, link.url, link.sortOrder);
    }

    private ProcurementCompanyNoteDto toCompanyNoteDto(ProcurementCompanyNote note) {
        return new ProcurementCompanyNoteDto(
                note.id,
                note.content,
                note.authorUserId,
                note.authorName,
                note.createdAt,
                note.updatedAt);
    }

    private ProcurementCompanyNote getCompanyNote(Long projectId, Long companyId, Long noteId) {
        getCompany(projectId, companyId);
        ProcurementCompanyNote note =
                companyNotes
                        .findById(noteId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Заметка не найдена"));
        if (!companyId.equals(note.companyId))
            throw new AppExceptions.NotFound("Заметка не найдена");
        return note;
    }

    private void requireNoteOwner(ProcurementCompanyNote note, CurrentUser actor) {
        if (note.authorUserId == null || !note.authorUserId.equals(actor.id())) {
            throw new AppExceptions.Forbidden("procurement.note.owner");
        }
    }

    private ProcurementFileDto toFileDto(ProcurementFile file, Long projectId) {
        return new ProcurementFileDto(
                file.id,
                file.companyId,
                file.displayName,
                file.fileName,
                "/api/admin/procurement/" + projectId + "/files/" + file.id + "/download",
                file.originalFileName,
                file.contentType,
                file.fileSize,
                file.uploadedByUserId,
                file.createdAt);
    }

    private ProcurementPaymentDto toPaymentDto(ProcurementPayment payment) {
        return new ProcurementPaymentDto(
                payment.id,
                payment.amount,
                payment.currency,
                payment.paidAt,
                payment.comment,
                payment.createdByUserId,
                payment.createdAt,
                payment.updatedAt);
    }

    private ProcurementStatusHistoryDto toHistoryDto(ProcurementStatusHistory history) {
        return new ProcurementStatusHistoryDto(
                history.id,
                history.oldStatus,
                history.newStatus,
                history.comment,
                history.actorUserId,
                history.actorName,
                history.createdAt);
    }

    private String normalize(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
    }
}
