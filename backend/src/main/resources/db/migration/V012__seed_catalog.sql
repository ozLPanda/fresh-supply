insert into categories(name_ru,name_kk,description_ru,description_kk,slug,sort_order,active) values
('Котлы','Қазандар','Газовые и электрические котлы для отопления.','Жылытуға арналған газ және электр қазандары.','boilers',10,true),
('Радиаторы','Радиаторлар','Биметаллические, алюминиевые и стальные радиаторы.','Биметалл, алюминий және болат радиаторлар.','radiators',20,true),
('Насосы','Сорғылар','Циркуляционные насосы и комплектующие.','Айналым сорғылары және жабдықтары.','pumps',30,true);
insert into products(sku,name_ru,name_kk,short_description_ru,short_description_kk,description_ru,description_kk,price,wholesale_price,bulk_wholesale_price,category_id,active)
select 'HM-24X','Газовый котел HeatMaster X 24 кВт','HeatMaster X 24 кВт газ қазаны','Двухконтурный котел с закрытой камерой сгорания.','Жабық жану камерасы бар екі контурлы қазан.','Подходит для частных домов и небольших коммерческих объектов.','Жеке үйлер мен шағын коммерциялық нысандарға жарайды.',389000,365000,342000,c.id,true from categories c where c.slug='boilers';
