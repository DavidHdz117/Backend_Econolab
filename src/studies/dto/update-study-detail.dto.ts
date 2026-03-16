import { PartialType } from '@nestjs/mapped-types';
import { CreateStudyDetailDto } from './create-study-detail.dto';

export class UpdateStudyDetailDto extends PartialType(CreateStudyDetailDto) {}
