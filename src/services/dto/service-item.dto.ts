import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceItemPriceType } from '../entities/service-order.entity';

export class CreateServiceItemDto {
  @Type(() => Number)
  @IsInt({ message: 'El identificador del estudio debe ser un número entero.' })
  studyId: number;

  @IsEnum(ServiceItemPriceType, {
    message:
      'El tipo de precio es inválido. Valores permitidos: normal, dif, special, hospital, other.',
  })
  priceType: ServiceItemPriceType;

  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un número entero.' })
  @Min(1, { message: 'La cantidad mínima es 1.' })
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El descuento debe ser numérico.' })
  @Min(0, { message: 'El descuento no puede ser negativo.' })
  discountPercent?: number;
}
