package kz.company.shop.settings.repository;

import kz.company.shop.settings.entity.ProjectSetting;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectSettingRepository extends JpaRepository<ProjectSetting, String> {}
